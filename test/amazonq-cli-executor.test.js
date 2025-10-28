const { AmazonQCLIExecutor } = require('../src/executors/amazonq-cli-executor');

describe('AmazonQCLIExecutor', () => {
  let executor;
  let mockTimingTracker;

  beforeEach(() => {
    mockTimingTracker = {
      record: jest.fn(),
      start: jest.fn(),
      end: jest.fn(),
    };
    executor = new AmazonQCLIExecutor(mockTimingTracker);
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

    test('sets ACTION_INPUTS_PRESENT flag', () => {
      const env = executor.getEnvironmentVariables();

      expect(env.GITHUB_ACTION_INPUTS).toBeDefined();
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

  describe('extractToolTimings', () => {
    test('extracts tool name and duration in seconds', () => {
      const output = `● Running get_file with the param:
  { "path": "test.js" }
● Completed in 1.5s`;

      executor.extractToolTimings(output);

      expect(mockTimingTracker.record).toHaveBeenCalledWith(
        'Tool: get_file',
        1500,
        expect.objectContaining({ toolName: 'get_file' })
      );
    });

    test('extracts tool name and duration in milliseconds', () => {
      const output = `● Running analyze_code with param
● Completed in 250ms`;

      executor.extractToolTimings(output);

      expect(mockTimingTracker.record).toHaveBeenCalledWith(
        'Tool: analyze_code',
        250,
        expect.objectContaining({ toolName: 'analyze_code' })
      );
    });

    test('extracts multiple tool timings', () => {
      const output = `● Running tool1 with param
● Completed in 1s
Some output
● Running tool2 with param
● Completed in 500ms`;

      executor.extractToolTimings(output);

      expect(mockTimingTracker.record).toHaveBeenCalledTimes(2);
      expect(mockTimingTracker.record).toHaveBeenCalledWith('Tool: tool1', 1000, expect.any(Object));
      expect(mockTimingTracker.record).toHaveBeenCalledWith('Tool: tool2', 500, expect.any(Object));
    });

    test('does nothing when no timing tracker', () => {
      const executorWithoutTracker = new AmazonQCLIExecutor(null);

      expect(() => {
        executorWithoutTracker.extractToolTimings('● Running tool\n● Completed in 1s');
      }).not.toThrow();
    });

    test('handles output without tool timings', () => {
      executor.extractToolTimings('Just some regular output');

      expect(mockTimingTracker.record).not.toHaveBeenCalled();
    });

    test('handles incomplete tool blocks', () => {
      executor.extractToolTimings('● Running tool_name');

      expect(mockTimingTracker.record).not.toHaveBeenCalled();
    });

    test('handles completed without running', () => {
      executor.extractToolTimings('● Completed in 1s');

      expect(mockTimingTracker.record).not.toHaveBeenCalled();
    });

    test('strips ANSI codes before parsing', () => {
      const output = '\x1b[32m● Running tool1\x1b[0m\n\x1b[32m● Completed in 1s\x1b[0m';

      executor.extractToolTimings(output);

      expect(mockTimingTracker.record).toHaveBeenCalledWith('Tool: tool1', 1000, expect.any(Object));
    });

    test('extracts tool name with underscores', () => {
      const output = `● Running get_file_contents with param
● Completed in 2s`;

      executor.extractToolTimings(output);

      expect(mockTimingTracker.record).toHaveBeenCalledWith(
        'Tool: get_file_contents',
        2000,
        expect.objectContaining({ toolName: 'get_file_contents' })
      );
    });

    test('handles decimal durations', () => {
      const output = `● Running tool with param
● Completed in 0.727s`;

      executor.extractToolTimings(output);

      expect(mockTimingTracker.record).toHaveBeenCalledWith('Tool: tool', 727, expect.any(Object));
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
});
