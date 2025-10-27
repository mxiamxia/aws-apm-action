const { run } = require('../src/init');
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
const mockOctokit = {
  rest: {
    repos: {
      getBranch: jest.fn(),
    },
    git: {
      createRef: jest.fn(),
    },
    issues: {
      createComment: jest.fn(),
      listComments: jest.fn(),
    },
    pulls: {
      get: jest.fn(),
      listFiles: jest.fn(),
    },
  },
};

jest.mock('@actions/github', () => ({
  context: {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {
      repository: { name: 'test-repo', default_branch: 'main' },
      comment: {
        id: 123,
        body: '@awsapm analyze this',
        user: { login: 'test-user' }
      },
      issue: {
        number: 1,
        pull_request: null
      }
    },
    eventName: 'issue_comment',
    actor: 'test-user'
  },
  getOctokit: jest.fn(() => mockOctokit)
}));

const core = require('@actions/core');

describe('init', () => {
  let originalEnv;
  let tempDir;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
    mockExit.mockClear();

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'init-test-'));

    // Set up environment
    process.env.RUNNER_TEMP = tempDir;
    process.env.BOT_NAME = '@awsapm';
    process.env.DEFAULT_WORKFLOW_TOKEN = 'test-token';
    process.env.GITHUB_RUN_ID = '123456';
  });

  afterEach(() => {
    process.env = originalEnv;

    // Cleanup temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('trigger detection', () => {
    test('detects trigger when bot name mentioned', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('skips execution when bot name not mentioned', async () => {
      const github = require('@actions/github');
      github.context.payload.comment.body = 'Regular comment without mention';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'false');
    });

    test('handles different bot names', async () => {
      process.env.BOT_NAME = '@mybot';
      const github = require('@actions/github');
      github.context.payload.comment.body = '@mybot help me';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('case insensitive bot name matching', async () => {
      const github = require('@actions/github');
      github.context.payload.comment.body = '@AwsApm analyze this';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });
  });

  describe('prompt creation', () => {
    test('creates prompt directory', async () => {
      await run();

      const promptDir = path.join(tempDir, 'awsapm-prompts');
      expect(fs.existsSync(promptDir)).toBe(true);
    });

    test('creates prompt file with user request', async () => {
      await run();

      const promptFile = path.join(tempDir, 'awsapm-prompts', 'awsapm-prompt.txt');
      expect(fs.existsSync(promptFile)).toBe(true);

      const content = fs.readFileSync(promptFile, 'utf8');
      expect(content).toContain('analyze this');
    });

    test('removes bot name from prompt', async () => {
      await run();

      const promptFile = path.join(tempDir, 'awsapm-prompts', 'awsapm-prompt.txt');
      const content = fs.readFileSync(promptFile, 'utf8');

      expect(content).not.toContain('@awsapm');
    });

    test('handles multiline comments', async () => {
      const github = require('@actions/github');
      github.context.payload.comment.body = `@awsapm
Line 1
Line 2`;

      await run();

      const promptFile = path.join(tempDir, 'awsapm-prompts', 'awsapm-prompt.txt');
      const content = fs.readFileSync(promptFile, 'utf8');

      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2');
    });
  });

  describe('branch creation', () => {
    test('creates unique branch name', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith(
        'AWSAPM_BRANCH',
        expect.stringContaining('awsapm/')
      );
    });

    test('includes run ID in branch name', async () => {
      process.env.GITHUB_RUN_ID = '789';

      await run();

      const outputs = core.setOutput.mock.calls;
      const branchCall = outputs.find(call => call[0] === 'AWSAPM_BRANCH');

      expect(branchCall[1]).toContain('789');
    });

    test('uses branch prefix from environment', async () => {
      process.env.BRANCH_PREFIX = 'mybot/';

      await run();

      const outputs = core.setOutput.mock.calls;
      const branchCall = outputs.find(call => call[0] === 'AWSAPM_BRANCH');

      expect(branchCall[1]).toStartWith('mybot/');
    });

    test('creates git reference for branch', async () => {
      mockOctokit.rest.repos.getBranch.mockResolvedValue({
        data: { commit: { sha: 'abc123' } }
      });

      await run();

      expect(mockOctokit.rest.git.createRef).toHaveBeenCalled();
    });
  });

  describe('comment tracking', () => {
    test('creates tracking comment', async () => {
      mockOctokit.rest.issues.createComment.mockResolvedValue({
        data: { id: 456 }
      });

      await run();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });

    test('sets comment ID output', async () => {
      mockOctokit.rest.issues.createComment.mockResolvedValue({
        data: { id: 456 }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('awsapm_comment_id', 456);
    });

    test('tracking comment contains processing message', async () => {
      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      const commentBody = call[0].body;

      expect(commentBody).toContain('Processing');
    });

    test('tracking comment includes user mention', async () => {
      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      const commentBody = call[0].body;

      expect(commentBody).toContain('@test-user');
    });
  });

  describe('GitHub token handling', () => {
    test('uses provided GitHub token', async () => {
      process.env.OVERRIDE_GITHUB_TOKEN = 'custom-token';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('GITHUB_TOKEN', 'custom-token');
    });

    test('falls back to default token', async () => {
      delete process.env.OVERRIDE_GITHUB_TOKEN;

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('GITHUB_TOKEN', 'test-token');
    });
  });

  describe('target branch', () => {
    test('uses provided target branch', async () => {
      process.env.TARGET_BRANCH = 'develop';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('TARGET_BRANCH', 'develop');
    });

    test('falls back to repository default branch', async () => {
      delete process.env.TARGET_BRANCH;

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('TARGET_BRANCH', 'main');
    });
  });

  describe('permissions', () => {
    test('allows users with write access', async () => {
      // Default behavior should allow
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('allows users in allowed list', async () => {
      process.env.ALLOWED_NON_WRITE_USERS = 'user1,test-user,user2';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });
  });

  describe('outputs', () => {
    test('sets all required outputs', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', expect.any(String));
      expect(core.setOutput).toHaveBeenCalledWith('GITHUB_TOKEN', expect.any(String));
      expect(core.setOutput).toHaveBeenCalledWith('AWSAPM_BRANCH', expect.any(String));
      expect(core.setOutput).toHaveBeenCalledWith('TARGET_BRANCH', expect.any(String));
    });

    test('sets tracing mode from environment', async () => {
      process.env.TRACING_MODE = 'true';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('TRACING_MODE', 'true');
    });
  });

  describe('error handling', () => {
    test('handles API errors gracefully', async () => {
      mockOctokit.rest.issues.createComment.mockRejectedValue(new Error('API error'));

      await run();

      expect(core.error).toHaveBeenCalled();
    });

    test('logs errors without failing', async () => {
      mockOctokit.rest.git.createRef.mockRejectedValue(new Error('Branch creation failed'));

      await run();

      expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Branch creation failed'));
    });
  });
});
