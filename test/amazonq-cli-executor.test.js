const { AmazonQCLIExecutor } = require('../src/executors/amazonq-cli-executor');

describe('AmazonQCLIExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new AmazonQCLIExecutor();
    jest.clearAllMocks();
  });

  describe('getCommandName', () => {
    test('returns correct command name', () => {
      expect(executor.getCommandName()).toBe('q');
    });
  });

  describe('getCommandArgs', () => {
    test('returns correct command arguments', () => {
      const args = executor.getCommandArgs();

      expect(args).toContain('chat');
      expect(args).toContain('--no-interactive');
      expect(args).toContain('--trust-all-tools');
    });

    test('returns array with three arguments', () => {
      const args = executor.getCommandArgs();
      expect(args).toHaveLength(3);
    });
  });

  describe('getEnvironmentVariables', () => {
    test('includes AMAZON_Q_SIGV4 authentication', () => {
      const env = executor.getEnvironmentVariables();

      expect(env.AMAZON_Q_SIGV4).toBe('1');
    });

    test('includes GitHub token from environment', () => {
      process.env.GITHUB_TOKEN = 'test-token-123';

      const env = executor.getEnvironmentVariables();

      expect(env.GITHUB_TOKEN).toBe('test-token-123');
      expect(env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('test-token-123');
    });

    test('includes GitHub repository context', () => {
      process.env.GITHUB_REPOSITORY = 'owner/repo';
      process.env.GITHUB_REF = 'refs/heads/main';
      process.env.GITHUB_SHA = 'abc123def';
      process.env.GITHUB_WORKSPACE = '/workspace';

      const env = executor.getEnvironmentVariables();

      expect(env.GITHUB_REPOSITORY).toBe('owner/repo');
      expect(env.GITHUB_REF).toBe('refs/heads/main');
      expect(env.GITHUB_SHA).toBe('abc123def');
      expect(env.GITHUB_WORKSPACE).toBe('/workspace');
    });
  });

  describe('parseOutput', () => {
    test('cleans the output using OutputCleaner', () => {
      const input = `Tool output
● Completed in 1s
🎯 **Application observability for AWS Assistant Result**

Result text`;

      const output = executor.parseOutput(input);

      expect(output).toContain('🎯 **Application observability for AWS Assistant Result**');
      expect(output).toContain('Result text');
      expect(output).not.toContain('Tool output');
    });

    test('removes ANSI codes', () => {
      const input = '\x1b[31mRed text\x1b[0m';
      const output = executor.parseOutput(input);

      expect(output).not.toContain('\x1b');
      expect(output).toBe('Red text');
    });
  });

  describe('outputCleaner integration', () => {
    test('has OutputCleaner instance', () => {
      expect(executor.outputCleaner).toBeDefined();
    });

    test('uses outputCleaner in parseOutput', () => {
      const spy = jest.spyOn(executor.outputCleaner, 'cleanAmazonQOutput');

      executor.parseOutput('test');

      expect(spy).toHaveBeenCalledWith('test');
      spy.mockRestore();
    });
  });

  describe('setupConfiguration', () => {
    test('setupConfiguration method exists', () => {
      expect(typeof executor.setupConfiguration).toBe('function');
    });

    // Note: Comprehensive setupConfiguration tests are in amazonq-cli-setup.test.js
    // which has proper mocking for fs operations
  });
});
