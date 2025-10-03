/**
 * Centralized MCP configuration management for both Claude CLI and Amazon Q CLI
 * This eliminates code duplication and provides a single source of truth for MCP configurations
 */
class MCPConfigManager {
  constructor() {
    this.testMode = this.isTestMode();
  }

  /**
   * Check if we're in test mode (using custom git repo for testing)
   */
  isTestMode() {
    // Using test MCP server from custom git repository
    return true; // Currently always in test mode as per latest configuration
  }

  /**
   * Get AWS CloudWatch AppSignals MCP server configuration
   */
  getAppSignalsServerConfig() {
    return {
      command: "uvx",
      args: this.testMode
        ? [
            "--no-cache",
            "--from",
            "git+https://github.com/mxiamxia/mcp.git#subdirectory=src/cloudwatch-appsignals-mcp-server",
            "awslabs.cloudwatch-appsignals-mcp-server"
          ]
        : ["awslabs.cloudwatch-appsignals-mcp-server@latest"],
      transportType: "stdio"
    };
  }

  /**
   * Get GitHub MCP server configuration (Docker-based)
   */
  getGitHubServerConfig(token) {
    return {
      command: "docker",
      args: [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "-e",
        "GITHUB_HOST",
        "-e",
        "GITHUB_REPOSITORY",
        "ghcr.io/github/github-mcp-server:sha-efef8ae"
      ],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: token,
        GITHUB_HOST: process.env.GITHUB_SERVER_URL || "https://github.com",
        GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY
      },
      transportType: "stdio"
    };
  }

  /**
   * Get list of AWS CloudWatch AppSignals MCP tools for auto-approval
   */
  getAppSignalsToolsList() {
    return [
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__list_monitored_services",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__get_service_detail",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__list_slis",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__get_slo",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__search_Transaction_spans",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__search_transaction_spans",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__query_sampled_traces",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__query_service_metrics",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__get_enablement_guide"
    ];
  }

  /**
   * Get list of GitHub MCP tools for auto-approval
   */
  getGitHubToolsList() {
    return [
      "mcp__github__create_pull_request",
      "mcp__github__create_or_update_file",
      "mcp__github__push_files",
      "mcp__github__get_file",
      "mcp__github__create_branch",
      "mcp__github__list_files",
      "mcp__github__get_file_contents"
    ];
  }

  /**
   * Get allowed tools string for Claude CLI (with wildcards and specific tool names)
   */
  getAllowedToolsForClaude() {
    const workingDir = process.env.GITHUB_WORKSPACE || process.cwd();

    const allowedTools = [
      // File operations (restricted to target repository)
      `Read(${workingDir}/**)`,
      `Edit(${workingDir}/**)`,
      `MultiEdit(${workingDir}/**)`,
      `Glob(${workingDir}/**)`,
      `Grep(${workingDir}/**)`,

      // Git operations
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git show:*)",
      "Bash(git checkout:*)",
      "Bash(git branch:*)",

      // System commands (restricted to working directory)
      `Bash(ls:${workingDir}/**)`,
      `Bash(find:${workingDir}/**)`,
      `Bash(cat:${workingDir}/**)`,
      `Bash(head:${workingDir}/**)`,
      `Bash(tail:${workingDir}/**)`,
      `Bash(wc:${workingDir}/**)`,

      // GitHub MCP tools
      "mcp__github__*",
      ...this.getGitHubToolsList()
    ];

    // Add AWS MCP tools if credentials are available
    if (this.hasAWSCredentials()) {
      allowedTools.push(
        "mcp__*",
        "mcp__awslabs_cloudwatch-appsignals-mcp-server__*",
        ...this.getAppSignalsToolsList()
      );
    }

    return allowedTools.join(',');
  }

  /**
   * Build complete MCP configuration for specified CLI type
   * @param {string} cliType - 'claude' or 'amazonq'
   * @returns {object} MCP configuration object
   */
  buildMCPConfig(cliType = 'claude') {
    const config = { mcpServers: {} };

    // Add AWS CloudWatch AppSignals MCP server if credentials available
    if (this.hasAWSCredentials()) {
      const appSignalsConfig = this.getAppSignalsServerConfig();

      if (cliType === 'claude') {
        // Claude CLI format
        config.mcpServers["awslabs.cloudwatch-appsignals-mcp-server"] = {
          ...appSignalsConfig,
          env: this.getAWSEnvVars()
        };
      } else {
        // Amazon Q CLI format
        config.mcpServers["awslabs.cloudwatch-appsignals-mcp"] = {
          ...appSignalsConfig,
          autoApprove: this.getAppSignalsToolsList(),
          disabled: false
        };
      }
    }

    // Add GitHub MCP server if token available
    if (this.hasGitHubToken()) {
      const githubConfig = this.getGitHubServerConfig(process.env.GITHUB_TOKEN);

      config.mcpServers.github = {
        ...githubConfig,
        autoApprove: this.getGitHubToolsList(),
        disabled: false
      };
    }

    return config;
  }

  /**
   * Check if AWS credentials are available
   */
  hasAWSCredentials() {
    return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  }

  /**
   * Check if GitHub token is available
   */
  hasGitHubToken() {
    return !!process.env.GITHUB_TOKEN;
  }

  /**
   * Get AWS environment variables for Claude CLI
   */
  getAWSEnvVars() {
    return {
      aws_access_key_id: process.env.AWS_ACCESS_KEY_ID,
      aws_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_REGION: process.env.AWS_REGION || 'us-east-1'
    };
  }
}

module.exports = { MCPConfigManager };
