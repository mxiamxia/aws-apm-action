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
    execute: jest.fn().mockResolvedValue('Test analysis result')
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

    test('saves investigation result to file', async () => {
      await run();

      const resultFile = path.join(tempDir, 'awsapm-output', 'investigation-result.txt');
      expect(fs.existsSync(resultFile)).toBe(true);
      expect(fs.readFileSync(resultFile, 'utf8')).toBe('Test analysis result');
    });

    test('saves response to awsapm-response.txt', async () => {
      await run();

      const responseFile = path.join(tempDir, 'awsapm-output', 'awsapm-response.txt');
      expect(fs.existsSync(responseFile)).toBe(true);
      expect(fs.readFileSync(responseFile, 'utf8')).toBe('Test analysis result');
    });

    test('sets execution_file output', async () => {
      await run();

      const responseFile = path.join(tempDir, 'awsapm-output', 'awsapm-response.txt');
      expect(core.setOutput).toHaveBeenCalledWith('execution_file', responseFile);
    });

    test('sets conclusion to success', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('conclusion', 'success');
    });

    test('sets investigation_result output', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('investigation_result', 'Test analysis result');
    });

    test('sets final_response output', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('final_response', 'Test analysis result');
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

      expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Amazon Q Developer CLI failed'));
    });

    test('writes error message to output on failure', async () => {
      AmazonQCLIExecutor.mockImplementation(() => ({
        execute: jest.fn().mockRejectedValue(new Error('Test error'))
      }));

      await run();

      const responseFile = path.join(tempDir, 'awsapm-output', 'awsapm-response.txt');
      const content = fs.readFileSync(responseFile, 'utf8');

      expect(content).toContain('❌ **Amazon Q Investigation Failed**');
      expect(content).toContain('Test error');
    });

    test('sets conclusion to failure on error', async () => {
      AmazonQCLIExecutor.mockImplementation(() => ({
        execute: jest.fn().mockRejectedValue(new Error('Test error'))
      }));

      await run();

      // Should still complete but with error content
      const outputs = core.setOutput.mock.calls;
      const conclusionCall = outputs.find(call => call[0] === 'conclusion');
      expect(conclusionCall).toBeDefined();
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
