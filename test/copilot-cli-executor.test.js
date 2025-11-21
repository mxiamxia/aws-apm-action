const { CopilotCLIExecutor } = require('../src/executors/copilot-cli-executor');

describe('CopilotCLIExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new CopilotCLIExecutor();
    jest.clearAllMocks();
  });

  describe('getCommandName', () => {
    test('returns correct command name', () => {
      expect(executor.getCommandName()).toBe('copilot');
    });
  });

  describe('getCommandArgs', () => {
    test('returns correct command arguments', () => {
      const args = executor.getCommandArgs();

      expect(args).toContain('--allow-all-tools');
    });

    test('returns array with one argument', () => {
      const args = executor.getCommandArgs();
      expect(args).toHaveLength(1);
    });
  });

  describe('getEnvironmentVariables', () => {
    test('uses CLI_AUTH_TOKEN when available', () => {
      process.env.CLI_AUTH_TOKEN = 'cli-token';
      process.env.GITHUB_TOKEN = 'github-token';

      const env = executor.getEnvironmentVariables();

      expect(env.GITHUB_TOKEN).toBe('cli-token');
    });

    test('falls back to GITHUB_TOKEN', () => {
      delete process.env.CLI_AUTH_TOKEN;
      process.env.GITHUB_TOKEN = 'github-token';

      const env = executor.getEnvironmentVariables();

      expect(env.GITHUB_TOKEN).toBe('github-token');
    });

    test('includes XDG_CONFIG_HOME', () => {
      const env = executor.getEnvironmentVariables();

      expect(env.XDG_CONFIG_HOME).toBeDefined();
    });
  });

  describe('setupConfiguration', () => {
    test('setupConfiguration method exists', () => {
      expect(typeof executor.setupConfiguration).toBe('function');
    });

    // Note: Comprehensive setupConfiguration tests would require proper mocking
    // of fs operations and home directory access
  });

  describe('parseOutput', () => {
    test('cleans the output using OutputCleaner', () => {
      const input = `Tool output\n● Completed in 1s\n🎯 **Application observability for AWS Assistant Result**\n\nResult text`;

      const output = executor.parseOutput(input);

      expect(output).not.toContain('🎯 **Application observability for AWS Assistant Result**');
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
      const spy = jest.spyOn(executor.outputCleaner, 'cleanCopilotOutput');

      executor.parseOutput('test');

      expect(spy).toHaveBeenCalledWith('test');
      spy.mockRestore();
    });
  });
});