const { BaseCLIExecutor } = require('./base-cli-executor');
const { MCPConfigManager } = require('../config/mcp-config');
const fs = require('fs');
const path = require('path');

/**
 * Claude Code CLI executor
 * Handles Claude-specific configuration and output parsing
 */
class ClaudeCLIExecutor extends BaseCLIExecutor {
  constructor(timingTracker = null) {
    super(timingTracker);
    this.mcpConfigPath = null;
  }

  getCommandName() {
    return 'claude';
  }

  getCommandArgs() {
    const args = [
      'code',  // Use 'code' subcommand for full file editing and GitHub operations
      '-p',  // Will use named pipe instead of file
      '--verbose',
      '--output-format', 'stream-json',
      '--allowed-tools', this.getAllowedTools()
    ];

    // Add MCP config if it was created and is valid
    if (this.mcpConfigPath && fs.existsSync(this.mcpConfigPath)) {
      args.push('--mcp-config', this.mcpConfigPath);
      console.log(`Using MCP configuration: ${this.mcpConfigPath}`);
    }

    return args;
  }

  getEnvironmentVariables() {
    // Check authentication
    if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      throw new Error('No authentication provided. Either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required.');
    }

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      console.log('Claude CLI will use CLAUDE_CODE_OAUTH_TOKEN for authentication');
    } else if (process.env.ANTHROPIC_API_KEY) {
      console.log('Claude CLI will use ANTHROPIC_API_KEY for authentication');
    }

    return {
      ...process.env,
      // Ensure non-interactive mode
      CLAUDE_NON_INTERACTIVE: '1',
      // Ensure GitHub Action inputs are available to Claude
      GITHUB_ACTION_INPUTS: process.env.INPUT_ACTION_INPUTS_PRESENT || '1',
      // Ensure GitHub token is available for MCP GitHub server (Docker)
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_HOST: process.env.GITHUB_SERVER_URL || 'https://github.com'
    };
  }

  /**
   * Build allowed tools string for Claude CLI (with wildcards and specific tool names)
   * Uses centralized MCPConfigManager
   */
  getAllowedTools() {
    const workingDir = process.env.GITHUB_WORKSPACE || process.cwd();
    console.log(`[DEBUG] Target repository working directory: ${workingDir}`);
    console.log(`[DEBUG] Current working directory: ${process.cwd()}`);
    console.log(`[DEBUG] Action path: ${process.env.GITHUB_ACTION_PATH || 'undefined'}`);

    const mcpConfigManager = new MCPConfigManager();
    const allowedToolsString = mcpConfigManager.getAllowedToolsForClaude();

    console.log(`[DEBUG] Final allowed tools string: ${allowedToolsString}`);
    console.log(`Allowed tools: ${allowedToolsString}`);

    return allowedToolsString;
  }

  /**
   * Create MCP configuration file for Claude CLI
   * Uses centralized MCPConfigManager
   */
  async setupConfiguration() {
    try {
      const mcpConfigManager = new MCPConfigManager();
      const mcpConfig = mcpConfigManager.buildMCPConfig('claude');

      // Only create config if we have at least one server
      if (Object.keys(mcpConfig.mcpServers).length === 0) {
        console.log('No MCP servers to configure');
        return null;
      }

      // Log configuration status
      if (mcpConfigManager.hasAWSCredentials()) {
        console.log('AWS credentials found, AWS MCP server configured');
        console.log(`AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
      }
      if (mcpConfigManager.hasGitHubToken()) {
        console.log('GitHub token found, GitHub MCP server configured');
      }
      if (mcpConfigManager.hasCloudWatchAccess()) {
        console.log('✓ CloudWatch MCP server configured');
        console.log('  - Available tools: metrics, logs, alarms, dashboards, insights');
      }

      // Create MCP config in temp directory (outside of repository)
      this.mcpConfigPath = path.join(this.tempDir, '.mcp.json');
      fs.writeFileSync(this.mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      console.log(`MCP configuration created at: ${this.mcpConfigPath}`);
      console.log('MCP Config:', JSON.stringify(mcpConfig, null, 2));

      return this.mcpConfigPath;
    } catch (error) {
      console.warn(`MCP setup failed (Claude CLI will continue without MCP): ${error.message}`);
      return null;
    }
  }

  /**
   * Custom output handling for Claude (show tool execution in real-time)
   * Try to parse as JSON and pretty print if it's on a single line (like claude-code-action)
   */
  onOutputData(text) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (line.trim() === '') return;

      try {
        // Check if this line is a JSON object
        const parsed = JSON.parse(line);
        const prettyJson = JSON.stringify(parsed, null, 2);
        process.stdout.write(prettyJson);
        if (index < lines.length - 1 || text.endsWith('\n')) {
          process.stdout.write('\n');
        }
      } catch (e) {
        // Not a JSON object, print as is
        process.stdout.write(line);
        if (index < lines.length - 1 || text.endsWith('\n')) {
          process.stdout.write('\n');
        }
      }
    });
  }

  /**
   * Extract tool call timings from Claude output
   * Claude CLI stream-json doesn't provide explicit timing per tool,
   * so we track tool usage counts and note that detailed timing isn't available
   * @param {string} output Raw CLI output
   */
  extractToolTimings(output) {
    if (!this.timingTracker) return;

    const responseLines = output.split('\n').filter(line => line.trim());
    const toolCalls = new Map();

    // Parse JSON stream to count tool calls
    for (const line of responseLines) {
      try {
        const parsed = JSON.parse(line);

        // Track tool usage
        if (parsed.type === 'tool_use' && parsed.tool && parsed.tool.name) {
          const toolName = parsed.tool.name;
          toolCalls.set(toolName, (toolCalls.get(toolName) || 0) + 1);
        }

        // Alternative: check assistant messages for tool_use content
        if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
          for (const content of parsed.message.content) {
            if (content.type === 'tool_use' && content.name) {
              const toolName = content.name;
              toolCalls.set(toolName, (toolCalls.get(toolName) || 0) + 1);
            }
          }
        }
      } catch (e) {
        // Skip non-JSON lines
      }
    }

    // Record tool calls (without exact timing since Claude doesn't provide it)
    // We record with 0ms duration just to show they were called
    for (const [toolName, count] of toolCalls.entries()) {
      for (let i = 0; i < count; i++) {
        const displayName = count > 1 ? `${toolName} (${i + 1}/${count})` : toolName;
        this.timingTracker.record(
          `Tool: ${displayName}`,
          0,
          { toolName, note: 'Claude CLI does not provide per-tool timing' }
        );
      }
    }
  }

  /**
   * Parse Claude's stream-json output
   * Extract the final result from the JSON stream (like claude-code-action does)
   */
  parseOutput(output) {
    const responseLines = output.split('\n').filter(line => line.trim());
    let finalResponse = '';
    let lastAssistantMessage = '';

    // Look for the final result in the JSON stream
    for (const line of responseLines) {
      try {
        const parsed = JSON.parse(line);

        // Extract text from assistant messages (keep only the last one to avoid duplicates)
        if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
          let currentMessage = '';
          for (const content of parsed.message.content) {
            if (content.type === 'text' && content.text) {
              currentMessage += content.text;
            }
          }
          if (currentMessage.trim()) {
            lastAssistantMessage = currentMessage; // Keep only the last assistant message
          }
        }

        // Extract final result
        if (parsed.type === 'result' && parsed.result) {
          finalResponse += parsed.result;
        }
      } catch (e) {
        // Skip non-JSON lines
      }
    }

    // Use the last assistant message as the final response (avoids duplicates)
    return lastAssistantMessage || finalResponse;
  }
}

module.exports = { ClaudeCLIExecutor };
