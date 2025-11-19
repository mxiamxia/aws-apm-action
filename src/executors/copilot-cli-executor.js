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
      '--allow-all-tools'
    ];
  }

  /**
   * Override execute method for Copilot CLI since it uses -p flag instead of stdin
   */
  async execute(promptContent) {
    const path = require('path');
    
    try {
      core.info('Running copilot CLI investigation...');

      // Test if CLI is available
      await this.testCLIAvailable();

      // Setup CLI-specific configuration
      const configPath = await this.setupConfiguration();

      // Get command args and env - add -p flag with promptContent
      const args = [...this.getCommandArgs(), '-p', promptContent];
      const env = this.getEnvironmentVariables();

      // Spawn CLI process
      const cliProcess = this.spawnCLIProcess('copilot', args, env, this.targetRepoDir);

      // Handle CLI process errors
      cliProcess.on('error', (error) => {
        core.error(`Error spawning copilot process: ${error.message}`);
        throw error;
      });

      // Capture output and wait for completion (NO TIMEOUT)
      const { output, exitCode } = await this.captureOutput(cliProcess);

      // Cleanup config file if needed
      if (configPath) {
        await this.cleanup([], [configPath]);
      }

      // Check exit code and parse output
      if (exitCode === 0) {
        core.info('copilot CLI completed successfully');
        const result = this.parseOutput(output.trim());
        return result || 'Investigation completed, but no output was generated.';
      } else {
        throw new Error(`copilot CLI exited with code ${exitCode}`);
      }

    } catch (error) {
      throw new Error(`copilot CLI execution failed: ${error.message}`);
    }
  }

  getEnvironmentVariables() {
    const copilotToken = process.env.CLI_AUTH_TOKEN || process.env.GITHUB_TOKEN;
    return {
      ...process.env,
      GITHUB_TOKEN: copilotToken,
      XDG_CONFIG_HOME: os.homedir()
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

      // Create AWS credentials file
      const awsDir = path.join(homeDir, '.aws');
      if (!fs.existsSync(awsDir)) {
        fs.mkdirSync(awsDir, { recursive: true });
      }

      const credentialsContent = `[default]
      aws_access_key_id = ${process.env.AWS_ACCESS_KEY_ID}
      aws_secret_access_key = ${process.env.AWS_SECRET_ACCESS_KEY}
      aws_session_token = ${process.env.AWS_SESSION_TOKEN || ''}
      region = ${process.env.AWS_REGION || 'us-east-1'}
      `;
      
      const credentialsPath = path.join(awsDir, 'credentials');
      fs.writeFileSync(credentialsPath, credentialsContent);
      core.info(`AWS credentials written to: ${credentialsPath}`);

      // Use MCPConfigManager to build configuration
      const mcpConfigManager = new MCPConfigManager();
      const mcpConfig = mcpConfigManager.buildMCPConfig('copilot');

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