const { MCPConfigManager } = require('../src/config/mcp-config');

describe('MCPConfigManager', () => {
  let manager;
  let originalEnv;

  beforeEach(() => {
    manager = new MCPConfigManager();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    test('creates instance', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('buildMCPConfig', () => {
    test('includes AppSignals server when AWS credentials present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers['awslabs.cloudwatch-appsignals-mcp']).toBeDefined();
      expect(config.mcpServers['awslabs.cloudwatch-appsignals-mcp'].command).toBe('uvx');
    });

    test('includes GitHub server when token is present', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers.github).toBeDefined();
      expect(config.mcpServers.github.command).toBe('docker');
      expect(config.mcpServers.github.args).toContain('ghcr.io/github/github-mcp-server:sha-efef8ae');
    });

    test('returns empty mcpServers when no credentials', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.GITHUB_TOKEN;

      const config = manager.buildMCPConfig();

      expect(config.mcpServers).toEqual({});
    });

    test('GitHub server has autoApprove list', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers.github.autoApprove).toBeDefined();
      expect(Array.isArray(config.mcpServers.github.autoApprove)).toBe(true);
      expect(config.mcpServers.github.autoApprove.length).toBeGreaterThan(0);
    });

    test('passes GitHub token to GitHub server env', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_test123');
    });

    test('GitHub server includes GITHUB_HOST env var', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';
      process.env.GITHUB_SERVER_URL = 'https://github.enterprise.com';

      const config = manager.buildMCPConfig();

      const githubEnv = config.mcpServers.github.env;
      expect(githubEnv.GITHUB_HOST).toBe('https://github.enterprise.com');
    });
  });

  describe('hasAWSCredentials', () => {
    test('returns true when credentials present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';

      expect(manager.hasAWSCredentials()).toBe(true);
    });

    test('returns false when credentials missing', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      expect(manager.hasAWSCredentials()).toBe(false);
    });

    test('returns false when only access key present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      delete process.env.AWS_SECRET_ACCESS_KEY;

      expect(manager.hasAWSCredentials()).toBe(false);
    });
  });

  describe('hasGitHubToken', () => {
    test('returns true when token present', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';

      expect(manager.hasGitHubToken()).toBe(true);
    });

    test('returns false when token missing', () => {
      delete process.env.GITHUB_TOKEN;

      expect(manager.hasGitHubToken()).toBe(false);
    });
  });

  describe('server configuration getters', () => {
    test('getAppSignalsServerConfig returns valid config', () => {
      const config = manager.getAppSignalsServerConfig();

      expect(config.command).toBe('uvx');
      expect(config.args).toBeDefined();
      expect(Array.isArray(config.args)).toBe(true);
      expect(config.transportType).toBe('stdio');
    });

    test('getGitHubServerConfig returns Docker config', () => {
      const config = manager.getGitHubServerConfig('test-token');

      expect(config.command).toBe('docker');
      expect(config.args).toContain('run');
      expect(config.args).toContain('-i');
      expect(config.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('test-token');
    });
  });

  describe('tool lists', () => {
    test('getAppSignalsToolsList returns array', () => {
      const tools = manager.getAppSignalsToolsList();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]).toContain('mcp__awslabs_cloudwatch-appsignals-mcp-server__');
    });

    test('getGitHubToolsList returns array', () => {
      const tools = manager.getGitHubToolsList();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toContain('mcp__github__create_pull_request');
    });
  });

  describe('getAWSEnvVars', () => {
    test('returns AWS environment variables', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      process.env.AWS_REGION = 'us-west-2';

      const envVars = manager.getAWSEnvVars();

      expect(envVars.aws_access_key_id).toBe('AKIATEST123');
      expect(envVars.aws_secret_access_key).toBe('secretkey');
      expect(envVars.AWS_REGION).toBe('us-west-2');
    });

    test('uses default region when not specified', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      delete process.env.AWS_REGION;

      const envVars = manager.getAWSEnvVars();

      expect(envVars.AWS_REGION).toBe('us-east-1');
    });
  });
});
