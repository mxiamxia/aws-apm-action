const core = require('@actions/core');
const { BaseCLIExecutor } = require('./base-cli-executor');
const { MCPConfigManager } = require('../config/mcp-config');
const { OutputCleaner } = require('../utils/output-cleaner');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * GitHub Copilot CLI executor
 * Handles Copilot-specific configuration and output parsing
 */
class CopilotCLIExecutor extends BaseCLIExecutor {
  constructor() {
    super();
    this.outputCleaner = new OutputCleaner();
  }

  getCommandName() {
    return 'copilot';
  }

  getCommandArgs() {
    return [
      'allow-all-tools',
      '-p'
    ];
  }

  getEnvironmentVariables() {
    return {
      ...process.env,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN
    };
  }

  /**
   * Setup MCP configuration for GitHub Copilot
   * Creates ~/.copilot/mcp-config.json with the same MCP servers as Q CLI
   */
  async setupConfiguration() {
    try {
      // Create Copilot MCP configuration directory
      const homeDir = os.homedir();
      const copilotConfigDir = path.join(homeDir, '.copilot');

      if (!fs.existsSync(copilotConfigDir)) {
        fs.mkdirSync(copilotConfigDir, { recursive: true });
      }

      // Use MCPConfigManager to build configuration
      const mcpConfigManager = new MCPConfigManager();
      const mcpConfig = mcpConfigManager.buildCopilotMCPConfig();

      // Create MCP configuration file
      const mcpConfigPath = path.join(copilotConfigDir, 'mcp-config.json');
      fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

      // Log configuration status
      if (!mcpConfigManager.hasGitHubToken()) {
        core.warning('GitHub token not available - PR creation will not work');
      }

      // Don't return the config path for cleanup since it's in home directory
      return null;

    } catch (error) {
      core.warning(`Failed to setup Copilot MCP configuration: ${error.message}`);
      core.warning('Copilot will run without MCP tools');
      return null;
    }
  }

  /**
   * Parse Copilot output and clean it
   */
  parseOutput(output) {
    core.debug(`Copilot raw output: ${output.length} chars`);

    const cleanOutput = this.outputCleaner.cleanCopilotOutput(output);

    core.debug(`Copilot cleaned output: ${cleanOutput.length} chars`);

    return cleanOutput;
  }
}

module.exports = { CopilotCLIExecutor };