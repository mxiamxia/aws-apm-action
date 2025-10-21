const { BaseCLIExecutor } = require('./base-cli-executor');
const { MCPConfigManager } = require('../config/mcp-config');
const { OutputCleaner } = require('../utils/output-cleaner');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Amazon Q Developer CLI executor
 * Handles Amazon Q-specific configuration and output parsing
 */
class AmazonQCLIExecutor extends BaseCLIExecutor {
  constructor(timingTracker = null) {
    super(timingTracker);
    this.outputCleaner = new OutputCleaner();
  }

  getCommandName() {
    return 'q';
  }

  getCommandArgs() {
    return [
      'chat',
      '--no-interactive',
      '--trust-all-tools'
    ];
  }

  getEnvironmentVariables() {
    console.log(`Full command: AMAZON_Q_SIGV4=1 q ${this.getCommandArgs().join(' ')} < pipe`);

    return {
      ...process.env,
      AMAZON_Q_SIGV4: '1',  // Enable SIGV4 authentication
      // Ensure GitHub token is available for MCP GitHub tools
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN,  // Alternative token name for MCP
      // Ensure GitHub Action inputs are available to Amazon Q
      GITHUB_ACTION_INPUTS: process.env.INPUT_ACTION_INPUTS_PRESENT || '1',
      // Repository context for GitHub MCP tools
      GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
      GITHUB_REF: process.env.GITHUB_REF,
      GITHUB_SHA: process.env.GITHUB_SHA,
      GITHUB_WORKSPACE: process.env.GITHUB_WORKSPACE
    };
  }

  /**
   * Setup MCP configuration for Amazon Q CLI
   * Uses centralized MCPConfigManager
   * Config is written to ~/.aws/amazonq/mcp.json (not temp dir)
   */
  async setupConfiguration() {
    const execAsync = promisify(require('child_process').exec);

    try {
      console.log('Setting up MCP configuration for Amazon Q CLI...');

      // Ensure uvx is installed for Amazon Q CLI
      try {
        await execAsync('uvx --version', { timeout: 10000 });
        console.log('uvx is available for MCP server execution');
      } catch (uvxError) {
        console.log('uvx not found, installing...');
        try {
          await execAsync('pip install uvx', { timeout: 60000 });
          console.log('uvx installed successfully');
        } catch (installError) {
          console.warn('Failed to install uvx:', installError.message);
          console.warn('MCP functionality may not work properly');
          return null;
        }
      }

      // Create MCP configuration directory
      const homeDir = os.homedir();
      const mcpConfigDir = path.join(homeDir, '.aws', 'amazonq');

      if (!fs.existsSync(mcpConfigDir)) {
        fs.mkdirSync(mcpConfigDir, { recursive: true });
        console.log(`Created MCP config directory: ${mcpConfigDir}`);
      }

      // Use MCPConfigManager to build configuration
      const mcpConfigManager = new MCPConfigManager();
      const mcpConfig = mcpConfigManager.buildMCPConfig();

      // Create MCP configuration file
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp.json');
      fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      console.log(`Created Amazon Q MCP configuration: ${mcpConfigPath}`);

      // Log configuration details
      console.log(`Full MCP config content:\n${JSON.stringify(mcpConfig, null, 2)}`);

      // Log server status with detailed context
      if (mcpConfigManager.hasAWSCredentials()) {
        console.log('✓ AWS MCP server configured');
      }
      if (mcpConfigManager.hasGitHubToken()) {
        console.log('✓ GitHub MCP server configured');
        console.log(`  - GitHub Host: ${process.env.GITHUB_SERVER_URL || 'https://github.com'}`);
        console.log(`  - Token available: ${process.env.GITHUB_TOKEN ? 'YES' : 'NO'}`);
      } else {
        console.warn('✗ GitHub token not available - PR creation will not work');
      }
      if (mcpConfigManager.hasCloudWatchAccess()) {
        console.log('✓ CloudWatch MCP server configured');
        console.log('  - Available tools: metrics, logs, alarms, dashboards, insights');
      }

      // Don't return the config path for cleanup since it's in home directory
      return null;

    } catch (error) {
      console.warn('Failed to setup Amazon Q MCP configuration:', error.message);
      console.warn('Amazon Q CLI will run without MCP tools');
      return null;
    }
  }

  /**
   * Extract tool call timings from Amazon Q output
   * Parses patterns like:
   * ● Running {tool_name} with the param:
   * ...
   * ● Completed in {duration}s
   * @param {string} output Raw CLI output
   */
  extractToolTimings(output) {
    if (!this.timingTracker) {
      console.log('[TIMING] No timing tracker available for tool extraction');
      return;
    }

    console.log('[TIMING] Extracting tool timings from Amazon Q output...');

    // Strip ANSI codes first to ensure regex patterns match correctly
    const cleanedOutput = this.outputCleaner.removeAnsiCodes(output);
    const lines = cleanedOutput.split('\n');

    let currentTool = null;
    let toolCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Match: ● Running {tool_name} with the param:
      const runningMatch = trimmed.match(/^●\s+Running\s+([^\s]+)/);
      if (runningMatch) {
        currentTool = runningMatch[1];
        console.log(`[TIMING] Found tool start: ${currentTool}`);
        continue;
      }

      // Match: ● Completed in {duration}s (or ms)
      const completedMatch = trimmed.match(/^●\s+Completed in\s+([\d.]+)(s|ms)/);
      if (completedMatch && currentTool) {
        const duration = parseFloat(completedMatch[1]);
        const unit = completedMatch[2];

        // Convert to milliseconds
        const durationMs = unit === 's' ? duration * 1000 : duration;

        console.log(`[TIMING] Tool ${currentTool} completed in ${durationMs}ms`);

        // Record tool timing
        this.timingTracker.record(
          `Tool: ${currentTool}`,
          durationMs,
          { toolName: currentTool }
        );

        toolCount++;
        currentTool = null;
      }
    }

    console.log(`[TIMING] Extracted ${toolCount} tool timings from output`);
  }

  /**
   * Parse Amazon Q output and clean it
   * Use OutputCleaner to remove ANSI codes and tool execution blocks
   */
  parseOutput(output) {
    const cleanOutput = this.outputCleaner.cleanAmazonQOutput(output);
    return cleanOutput;
  }
}

module.exports = { AmazonQCLIExecutor };
