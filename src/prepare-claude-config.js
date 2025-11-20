#!/usr/bin/env node

const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const { MCPConfigManager } = require('./config/mcp-config');

/**
 * Prepare Claude Code configuration files for claude-code-base-action
 * This script generates:
 * 1. MCP servers configuration JSON file
 * 2. Allowed tools list for Claude
 * 3. Outputs for claude-code-base-action to consume
 */
async function run() {
  try {
    core.info('Preparing Claude Code configuration...');

    const outputDir = process.env.OUTPUT_DIR || path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-prompts');
    const promptFile = process.env.INPUT_PROMPT_FILE;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Verify prompt file exists
    if (!promptFile || !fs.existsSync(promptFile)) {
      throw new Error(`Prompt file not found: ${promptFile}`);
    }
    core.info(`Prompt file found: ${promptFile}`);

    // Build MCP configuration for Claude
    const mcpManager = new MCPConfigManager();
    const mcpConfig = mcpManager.buildMCPConfig();

    // Log configuration status
    core.info('MCP Configuration Summary:');
    if (mcpManager.hasAWSCredentials()) {
      core.info('✓ AWS credentials found - Application Signals MCP configured');
      core.info(`  AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
    } else {
      core.warning('⚠ No AWS credentials found - Application Signals MCP disabled');
    }

    if (mcpManager.hasCloudWatchAccess()) {
      core.info('✓ CloudWatch MCP enabled');
      core.info('  Available tools: metrics, logs, alarms, dashboards, insights');
    } else {
      core.info('ℹ CloudWatch MCP disabled (enable_cloudwatch_mcp not set or no AWS credentials)');
    }

    if (mcpManager.hasGitHubToken()) {
      core.info('✓ GitHub MCP configured');
    } else {
      core.warning('⚠ No GitHub token found - GitHub MCP disabled');
    }

    const serverCount = Object.keys(mcpConfig.mcpServers).length;
    core.info(`Total MCP servers configured: ${serverCount}`);

    // Write MCP config to JSON file
    const mcpConfigFile = path.join(outputDir, 'mcp-servers.json');
    fs.writeFileSync(mcpConfigFile, JSON.stringify(mcpConfig, null, 2));
    core.info(`✓ MCP config written to: ${mcpConfigFile}`);

    // Get allowed tools for Claude
    const allowedTools = mcpManager.getAllowedToolsForClaude();
    const toolCount = allowedTools.split(',').length;
    core.info(`✓ Allowed tools configured: ${toolCount} tool patterns`);

    // Set outputs for claude-code-base-action
    core.setOutput('prompt_file', promptFile);
    core.setOutput('mcp_config_file', mcpConfigFile);
    core.setOutput('allowed_tools', allowedTools);

    core.info('Claude configuration prepared successfully');
    core.info('');
    core.info('Next steps:');
    core.info('1. Add anthropics/claude-code-base-action step to your workflow');
    core.info('2. Pass the outputs from this step to claude-code-base-action');
    core.info('3. Set ANTHROPIC_MODEL environment variable with your Bedrock model');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to prepare Claude config: ${errorMessage}`);
    core.setFailed(`Failed to prepare Claude config: ${errorMessage}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
