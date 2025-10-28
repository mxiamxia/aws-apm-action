const { run } = require('../src/post-result');
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
  setFailed: jest.fn(),
}));

// Mock @actions/github
const mockOctokit = {
  rest: {
    issues: {
      createComment: jest.fn(),
      updateComment: jest.fn(),
    },
  },
};

jest.mock('@actions/github', () => ({
  context: {
    payload: {
      repository: {
        html_url: 'https://github.com/test-owner/test-repo'
      }
    }
  },
  getOctokit: jest.fn(() => mockOctokit)
}));

const core = require('@actions/core');

describe('post-result', () => {
  let originalEnv;
  let tempDir;
  let outputFile;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
    mockExit.mockClear();

    // Create temp directory and output file
    tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'post-result-test-'));
    outputFile = path.join(tempDir, 'output.txt');
    fs.writeFileSync(outputFile, 'Test analysis result');

    // Set up environment
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.REPOSITORY = 'test-owner/test-repo';
    process.env.PR_NUMBER = '1';
    process.env.GITHUB_RUN_ID = '123456';
    process.env.AWSAPM_SUCCESS = 'true';
    process.env.OUTPUT_FILE = outputFile;
    process.env.TRIGGER_USERNAME = 'test-user';
    process.env.PREPARE_SUCCESS = 'true';
    process.env.IS_PR = 'true';
  });

  afterEach(() => {
    process.env = originalEnv;

    // Cleanup temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('update existing comment', () => {
    test('updates comment with output content', async () => {
      process.env.AWSAPM_COMMENT_ID = '456';
      mockOctokit.rest.issues.updateComment.mockResolvedValue({});

      await run();

      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 456,
          owner: 'test-owner',
          repo: 'test-repo'
        })
      );

      const call = mockOctokit.rest.issues.updateComment.mock.calls[0];
      expect(call[0].body).toContain('Test analysis result');
    });

    test('falls back to create comment on update error', async () => {
      process.env.AWSAPM_COMMENT_ID = '456';
      mockOctokit.rest.issues.updateComment.mockRejectedValue(new Error('Update failed'));
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });
  });

  describe('create new comment', () => {
    test('creates comment with output content', async () => {
      delete process.env.AWSAPM_COMMENT_ID;
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          issue_number: 1
        })
      );

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      expect(call[0].body).toContain('Test analysis result');
    });
  });

  describe('comment content', () => {
    test('includes success header', async () => {
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      expect(call[0].body).toContain('🎯 **Application observability for AWS Investigation Complete**');
    });

    test('includes workflow link', async () => {
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      expect(call[0].body).toContain('https://github.com/test-owner/test-repo/actions/runs/123456');
    });

    test('includes requester username', async () => {
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      expect(call[0].body).toContain('@test-user');
    });

    test('includes status indicator', async () => {
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      expect(call[0].body).toContain('✅ **Status**: Complete');
    });

    test('separates content with horizontal rules', async () => {
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      expect(call[0].body).toContain('---');
    });
  });

  describe('failure handling', () => {
    test('posts failure message when execution failed', async () => {
      process.env.AWSAPM_SUCCESS = 'false';
      delete process.env.OUTPUT_FILE;
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      expect(call[0].body).toContain('❌ **Application observability for AWS Investigation Failed**');
    });

    test('posts failure message when output file missing', async () => {
      process.env.AWSAPM_SUCCESS = 'true';
      process.env.OUTPUT_FILE = '/nonexistent/file.txt';
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      expect(call[0].body).toContain('❌ **Investigation Failed**');
    });

    test('includes workflow link in failure message', async () => {
      process.env.AWSAPM_SUCCESS = 'false';
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      expect(call[0].body).toContain('https://github.com/test-owner/test-repo/actions/runs/123456');
    });
  });

  describe('error handling', () => {
    test('logs error when token missing', async () => {
      delete process.env.GITHUB_TOKEN;

      await run();

      expect(core.error).toHaveBeenCalled();
      expect(core.setFailed).toHaveBeenCalled();
    });

    test('logs error when comment creation fails', async () => {
      mockOctokit.rest.issues.createComment.mockRejectedValue(new Error('API error'));

      await run();

      expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Comment update failed'));
    });

    test('exits with error code on failure', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      delete process.env.GITHUB_TOKEN;

      await run();

      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });
  });

  describe('repository parsing', () => {
    test('parses repository owner and name', async () => {
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo'
        })
      );
    });

    test('handles different repository formats', async () => {
      process.env.REPOSITORY = 'my-org/my-repo';
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'my-org',
          repo: 'my-repo'
        })
      );
    });
  });

  describe('issue number', () => {
    test('uses PR_NUMBER from environment', async () => {
      process.env.PR_NUMBER = '42';
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await run();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 42
        })
      );
    });

    test('skips comment when no issue number', async () => {
      delete process.env.PR_NUMBER;

      await run();

      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });
  });
});
