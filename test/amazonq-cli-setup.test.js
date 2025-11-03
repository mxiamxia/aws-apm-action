// Separate test file for setupConfiguration to allow proper mocking before module load
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock modules before importing executor
jest.mock('@actions/core', () => ({
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  info: jest.fn()
}));

jest.mock('child_process', () => ({
  exec: jest.fn()
}));

const { AmazonQCLIExecutor } = require('../src/executors/amazonq-cli-executor');
const core = require('@actions/core');
const { exec } = require('child_process');

describe('AmazonQCLIExecutor setupConfiguration', () => {
  let executor;
  let mkdirSyncSpy;
  let writeFileSyncSpy;
  let existsSyncSpy;
  let homedirSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new AmazonQCLIExecutor();

    // Mock filesystem operations
    mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue('/mock/home');

    // Mock exec to succeed by default
    exec.mockImplementation((cmd, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      setImmediate(() => callback(null, { stdout: 'success', stderr: '' }));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('creates MCP configuration directory', async () => {
    await executor.setupConfiguration();

    expect(mkdirSyncSpy).toHaveBeenCalledWith(
      path.join('/mock/home', '.aws', 'amazonq'),
      { recursive: true }
    );
  });

  test('writes MCP configuration file to ~/.aws/amazonq/mcp.json', async () => {
    await executor.setupConfiguration();

    expect(writeFileSyncSpy).toHaveBeenCalled();
    const call = writeFileSyncSpy.mock.calls[0];
    expect(call[0]).toBe(path.join('/mock/home', '.aws', 'amazonq', 'mcp.json'));

    // Verify it's valid JSON
    const configJson = call[1];
    expect(() => JSON.parse(configJson)).not.toThrow();
  });

  test('includes GitHub MCP server in configuration when token available', async () => {
    process.env.GITHUB_TOKEN = 'test-token';

    await executor.setupConfiguration();

    const configJson = writeFileSyncSpy.mock.calls[0][1];
    const config = JSON.parse(configJson);

    expect(config.mcpServers.github).toBeDefined();
    expect(config.mcpServers.github.command).toBe('docker');
  });

  test('warns when GitHub token is not available', async () => {
    delete process.env.GITHUB_TOKEN;

    await executor.setupConfiguration();

    expect(core.warning).toHaveBeenCalledWith(
      'GitHub token not available - PR creation will not work'
    );
  });

  test('checks for uvx installation', async () => {
    await executor.setupConfiguration();

    expect(exec).toHaveBeenCalledWith(
      'uvx --version',
      { timeout: 10000 },
      expect.any(Function)
    );
  });

  test('attempts to install uvx if not found', async () => {
    exec.mockImplementation((cmd, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      if (cmd.includes('uvx --version')) {
        setImmediate(() => callback(new Error('uvx not found')));
      } else if (cmd.includes('pip install uvx')) {
        setImmediate(() => callback(null, { stdout: 'Successfully installed', stderr: '' }));
      }
    });

    await executor.setupConfiguration();

    expect(exec).toHaveBeenCalledWith(
      'pip install uvx',
      { timeout: 60000 },
      expect.any(Function)
    );
  });

  test('warns if uvx installation fails', async () => {
    exec.mockImplementation((cmd, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      setImmediate(() => callback(new Error('Installation failed')));
    });

    const result = await executor.setupConfiguration();

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to install uvx')
    );
    expect(result).toBeNull();
  });

  test('skips creating directory if it already exists', async () => {
    existsSyncSpy.mockReturnValue(true);

    await executor.setupConfiguration();

    expect(mkdirSyncSpy).not.toHaveBeenCalled();
  });

  test('returns null (no cleanup needed for home directory config)', async () => {
    const result = await executor.setupConfiguration();

    expect(result).toBeNull();
  });

  test('handles errors gracefully and warns', async () => {
    writeFileSyncSpy.mockImplementation(() => {
      throw new Error('Write failed');
    });

    const result = await executor.setupConfiguration();

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to setup Amazon Q MCP configuration')
    );
    expect(core.warning).toHaveBeenCalledWith(
      'Amazon Q CLI will run without MCP tools'
    );
    expect(result).toBeNull();
  });

  test('configuration includes all required MCP servers', async () => {
    process.env.GITHUB_TOKEN = 'test-token';

    await executor.setupConfiguration();

    const configJson = writeFileSyncSpy.mock.calls[0][1];
    const config = JSON.parse(configJson);

    expect(config.mcpServers).toBeDefined();
    expect(typeof config.mcpServers).toBe('object');
  });
});
