const { BaseCLIExecutor } = require('../src/executors/base-cli-executor');
const { EventEmitter } = require('events');

// Mock child_process - must use factory function
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const { spawn: mockSpawn } = require('child_process');

// Mock @actions/core
jest.mock('@actions/core', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

const core = require('@actions/core');

// Create concrete test class
class TestCLIExecutor extends BaseCLIExecutor {
  getCommandName() {
    return 'test-command';
  }

  getCommandArgs() {
    return ['arg1', 'arg2'];
  }

  parseOutput(output) {
    return output;
  }
}

describe('BaseCLIExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new TestCLIExecutor();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('initializes with default values', () => {
      expect(executor.tempDir).toBeDefined();
      expect(executor.targetRepoDir).toBeDefined();
    });

    test('accepts timing tracker', () => {
      const mockTracker = { start: jest.fn(), end: jest.fn() };
      const executorWithTracker = new TestCLIExecutor(mockTracker);

      expect(executorWithTracker.timingTracker).toBe(mockTracker);
    });

    test('uses GITHUB_WORKSPACE for target directory', () => {
      process.env.GITHUB_WORKSPACE = '/test/workspace';
      const executorWithWorkspace = new TestCLIExecutor();

      expect(executorWithWorkspace.targetRepoDir).toBe('/test/workspace');
    });
  });

  describe('spawnCLIProcess', () => {
    test('creates process with correct stdio configuration', () => {
      const mockProcess = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      executor.spawnCLIProcess('test-cmd', ['arg1'], {}, '/path');

      expect(mockSpawn).toHaveBeenCalledWith(
        'test-cmd',
        ['arg1'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe']
        })
      );
    });

    test('sets correct working directory', () => {
      const mockProcess = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      executor.spawnCLIProcess('cmd', [], {}, '/custom/path');

      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd',
        [],
        expect.objectContaining({
          cwd: '/custom/path'
        })
      );
    });

    test('passes environment variables', () => {
      const mockProcess = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);
      const env = { TEST_VAR: 'value' };

      executor.spawnCLIProcess('cmd', [], env, '/path');

      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd',
        [],
        expect.objectContaining({
          env: env
        })
      );
    });
  });

  describe('captureOutput', () => {
    test('captures stdout data', (done) => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      const outputPromise = executor.captureOutput(mockProcess);

      mockProcess.stdout.emit('data', Buffer.from('stdout data'));
      mockProcess.emit('close', 0);

      outputPromise.then(({ output, exitCode }) => {
        expect(output).toBe('stdout data');
        expect(exitCode).toBe(0);
        done();
      });
    });

    test('captures stderr data', (done) => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      const outputPromise = executor.captureOutput(mockProcess);

      mockProcess.stderr.emit('data', Buffer.from('stderr data'));
      mockProcess.emit('close', 0);

      outputPromise.then(({ output, exitCode }) => {
        expect(output).toBe('stderr data');
        expect(exitCode).toBe(0);
        done();
      });
    });

    test('prefers stdout over stderr when both have data', (done) => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      const outputPromise = executor.captureOutput(mockProcess);

      mockProcess.stdout.emit('data', Buffer.from('stdout content'));
      mockProcess.stderr.emit('data', Buffer.from('stderr content'));
      mockProcess.emit('close', 0);

      outputPromise.then(({ output }) => {
        expect(output).toBe('stdout content');
        done();
      });
    });

    test('falls back to stderr when stdout is empty', (done) => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      const outputPromise = executor.captureOutput(mockProcess);

      mockProcess.stderr.emit('data', Buffer.from('stderr only'));
      mockProcess.emit('close', 0);

      outputPromise.then(({ output }) => {
        expect(output).toBe('stderr only');
        done();
      });
    });

    test('captures exit code', (done) => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      const outputPromise = executor.captureOutput(mockProcess);

      mockProcess.emit('close', 42);

      outputPromise.then(({ exitCode }) => {
        expect(exitCode).toBe(42);
        done();
      });
    });

    test('accumulates multiple data chunks', (done) => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      const outputPromise = executor.captureOutput(mockProcess);

      mockProcess.stdout.emit('data', Buffer.from('part1'));
      mockProcess.stdout.emit('data', Buffer.from('part2'));
      mockProcess.stdout.emit('data', Buffer.from('part3'));
      mockProcess.emit('close', 0);

      outputPromise.then(({ output }) => {
        expect(output).toBe('part1part2part3');
        done();
      });
    });
  });

  describe('abstract methods with concrete implementation', () => {
    test('getCommandName returns command name', () => {
      expect(executor.getCommandName()).toBe('test-command');
    });

    test('getCommandArgs returns arguments', () => {
      expect(executor.getCommandArgs()).toEqual(['arg1', 'arg2']);
    });

    test('parseOutput processes output', () => {
      expect(executor.parseOutput('test output')).toBe('test output');
    });
  });

  describe('abstract methods on base class', () => {
    let baseExecutor;

    beforeEach(() => {
      baseExecutor = new BaseCLIExecutor();
    });

    test('getCommandName throws when not implemented', () => {
      expect(() => baseExecutor.getCommandName()).toThrow('must be implemented by subclass');
    });

    test('getCommandArgs throws when not implemented', () => {
      expect(() => baseExecutor.getCommandArgs()).toThrow('must be implemented by subclass');
    });

    test('parseOutput throws when not implemented', () => {
      expect(() => baseExecutor.parseOutput('test')).toThrow('must be implemented by subclass');
    });
  });
});
