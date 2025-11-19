const { run } = require('../src/execute');
const fs = require('fs');
const path = require('path');

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

// Mock @actions/core
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
}));

// Mock @actions/github
jest.mock('@actions/github', () => ({
  context: {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: { repository: { name: 'test-repo' } }
  }
}));

// Mock AmazonQCLIExecutor
jest.mock('../src/executors/amazonq-cli-executor', () => ({
  AmazonQCLIExecutor: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue('🎯 **Application observability for AWS Assistant Result**\n\nTest analysis result')
  }))
}));

const core = require('@actions/core');
const { AmazonQCLIExecutor } = require('../src/executors/amazonq-cli-executor');

describe('execute', () => {
  let originalEnv;
  let tempDir;
  let promptFile;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
    mockExit.mockClear();

    // Create temp directory and prompt file
    tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'execute-test-'));
    promptFile = path.join(tempDir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'Test prompt content');

    // Set up environment
    process.env.INPUT_PROMPT_FILE = promptFile;
    process.env.RUNNER_TEMP = tempDir;
    process.env.GITHUB_RUN_ID = '12345';
  });

  afterEach(() => {
    process.env = originalEnv;

    // Cleanup temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('successful execution', () => {
    test('reads prompt file', async () => {
      await run();

      const mockExecutor = AmazonQCLIExecutor.mock.results[0].value;
      expect(mockExecutor.execute).toHaveBeenCalledWith('Test prompt content');
    });

    test('creates output directory', async () => {
      await run();

      const outputDir = path.join(tempDir, 'awsapm-output');
      expect(fs.existsSync(outputDir)).toBe(true);
    });

    test('runs Amazon Q CLI executor', async () => {
      await run();

      expect(AmazonQCLIExecutor).toHaveBeenCalled();
      const mockExecutor = AmazonQCLIExecutor.mock.results[0].value;
      expect(mockExecutor.execute).toHaveBeenCalled();
    });

    test('saves response to file with unique run ID', async () => {
      await run();

      const responseFile = path.join(tempDir, 'awsapm-output', 'awsapm-response-12345.txt');
      expect(fs.existsSync(responseFile)).toBe(true);
      // The output cleaner will process the result marker and return the cleaned content
      expect(fs.readFileSync(responseFile, 'utf8')).toContain('Test analysis result');
    });

    test('sets execution_file output', async () => {
      await run();

      const responseFile = path.join(tempDir, 'awsapm-output', 'awsapm-response-12345.txt');
      expect(core.setOutput).toHaveBeenCalledWith('execution_file', responseFile);
    });

    test('sets conclusion to success', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('conclusion', 'success');
    });
  });

  describe('AWS credentials', () => {
    test('passes AWS credentials from environment', async () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      process.env.AWS_SESSION_TOKEN = 'sessiontoken';
      process.env.AWS_REGION = 'us-west-2';

      await run();

      expect(process.env.AWS_ACCESS_KEY_ID).toBe('AKIATEST123');
      expect(process.env.AWS_SECRET_ACCESS_KEY).toBe('secretkey');
      expect(process.env.AWS_SESSION_TOKEN).toBe('sessiontoken');
      expect(process.env.AWS_REGION).toBe('us-west-2');
    });
  });

  describe('error handling', () => {
    test('handles missing prompt file', async () => {
      process.env.INPUT_PROMPT_FILE = '/nonexistent/file.txt';

      await run();

      expect(core.setFailed).toHaveBeenCalled();
      expect(core.error).toHaveBeenCalled();
    });

    test('handles executor failure', async () => {
      AmazonQCLIExecutor.mockImplementation(() => ({
        execute: jest.fn().mockRejectedValue(new Error('CLI execution failed'))
      }));

      await run();

      expect(core.error).toHaveBeenCalledWith(expect.stringContaining('CLI failed'));
    });

    test('writes error message to output on failure', async () => {
      AmazonQCLIExecutor.mockImplementation(() => ({
        execute: jest.fn().mockRejectedValue(new Error('Test error'))
      }));

      await run();

      const responseFile = path.join(tempDir, 'awsapm-output', 'awsapm-response-12345.txt');
      const content = fs.readFileSync(responseFile, 'utf8');

      expect(content).toContain('❌ **Investigation Failed**');
      expect(content).toContain('Test error');
    });

    test('sets conclusion to success even when executor fails (graceful degradation)', async () => {
      AmazonQCLIExecutor.mockImplementation(() => ({
        execute: jest.fn().mockRejectedValue(new Error('Test error'))
      }));

      await run();

      // Action completes successfully even if executor fails (writes error to response file)
      expect(core.setOutput).toHaveBeenCalledWith('conclusion', 'success');

      // Verify the response file contains the error message for the user
      const responseFile = path.join(tempDir, 'awsapm-output', 'awsapm-response-12345.txt');
      const content = fs.readFileSync(responseFile, 'utf8');
      expect(content).toContain('❌ **Investigation Failed**');
      expect(content).toContain('Test error');
    });

    test('sets error_message output on failure', async () => {
      process.env.INPUT_PROMPT_FILE = '/nonexistent/file.txt';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('conclusion', 'failure');
      expect(core.setOutput).toHaveBeenCalledWith('error_message', expect.any(String));
    });

    test('exits with code 1 on failure', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      process.env.INPUT_PROMPT_FILE = '/nonexistent/file.txt';

      await run();

      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });
  });
});
