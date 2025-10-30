const core = require('@actions/core');
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
    this.mcpLogs = [];
    this.toolCalls = [];
    this.rawOutput = '';
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
      // Ensure uvx is installed for Amazon Q CLI
      try {
        await execAsync('uvx --version', { timeout: 10000 });
      } catch (uvxError) {
        try {
          await execAsync('pip install uvx', { timeout: 60000 });
        } catch (installError) {
          core.warning(`Failed to install uvx: ${installError.message}`);
          return null;
        }
      }

      // Create MCP configuration directory
      const homeDir = os.homedir();
      const mcpConfigDir = path.join(homeDir, '.aws', 'amazonq');

      if (!fs.existsSync(mcpConfigDir)) {
        fs.mkdirSync(mcpConfigDir, { recursive: true });
      }

      // Use MCPConfigManager to build configuration
      const mcpConfigManager = new MCPConfigManager();
      const mcpConfig = mcpConfigManager.buildMCPConfig();

      // Create MCP configuration file
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp.json');
      fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

      // Log critical configuration status
      if (!mcpConfigManager.hasGitHubToken()) {
        core.warning('GitHub token not available - PR creation will not work');
      }

      // Don't return the config path for cleanup since it's in home directory
      return null;

    } catch (error) {
      core.warning(`Failed to setup Amazon Q MCP configuration: ${error.message}`);
      core.warning('Amazon Q CLI will run without MCP tools');
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
      return;
    }

    // Strip ANSI codes first to ensure regex patterns match correctly
    const cleanedOutput = this.outputCleaner.removeAnsiCodes(output);
    const lines = cleanedOutput.split('\n');

    let currentTool = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Match: ● Running {tool_name} with the param:
      const runningMatch = trimmed.match(/^●\s+Running\s+([^\s]+)/);
      if (runningMatch) {
        currentTool = runningMatch[1];
        continue;
      }

      // Match: ● Completed in {duration}s (or ms)
      const completedMatch = trimmed.match(/^●\s+Completed in\s+([\d.]+)(s|ms)/);
      if (completedMatch && currentTool) {
        const duration = parseFloat(completedMatch[1]);
        const unit = completedMatch[2];

        // Convert to milliseconds
        const durationMs = unit === 's' ? duration * 1000 : duration;

        // Record tool timing
        this.timingTracker.record(
          `Tool: ${currentTool}`,
          durationMs,
          { toolName: currentTool }
        );

        currentTool = null;
      }
    }
  }

  /**
   * Log MCP server interactions and tool calls
   */
  logMCPInteractions(output) {
    // Store raw output for debugging
    this.rawOutput = output;
    
    // Extract MCP server logs
    this.extractMCPServerLogs(output);
    
    // Extract tool calls
    this.extractToolCalls(output);
    
    // Save detailed logs to files
    this.saveMCPLogs();
  }

  /**
   * Extract MCP server startup and connection logs
   */
  extractMCPServerLogs(output) {
    const lines = output.split('\n');
    
    for (const line of lines) {
      // MCP server startup patterns
      if (line.includes('MCP server') || 
          line.includes('cloudwatch-appsignals-mcp-server') ||
          line.includes('github-mcp-server') ||
          line.includes('uvx') ||
          line.includes('docker run')) {
        this.mcpLogs.push({
          timestamp: new Date().toISOString(),
          type: 'server_startup',
          message: line.trim()
        });
      }
      
      // MCP connection/error patterns
      if (line.includes('Connected to') ||
          line.includes('Failed to connect') ||
          line.includes('MCP error') ||
          line.includes('Server error')) {
        this.mcpLogs.push({
          timestamp: new Date().toISOString(),
          type: 'connection',
          message: line.trim()
        });
      }
    }
  }

  /**
   * Extract detailed tool calls with parameters and responses
   */
  extractToolCalls(output) {
    const cleanedOutput = this.outputCleaner.removeAnsiCodes(output);
    const lines = cleanedOutput.split('\n');
    
    let currentTool = null;
    let toolParams = [];
    let toolResponse = [];
    let inParams = false;
    let inResponse = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Tool execution start
      const toolMatch = line.match(/●\s+Running\s+([^\s]+)\s+with\s+the\s+param/);
      if (toolMatch) {
        // Save previous tool if exists
        if (currentTool) {
          this.toolCalls.push({
            tool: currentTool,
            parameters: toolParams.join('\n'),
            response: toolResponse.join('\n'),
            timestamp: new Date().toISOString()
          });
        }
        
        currentTool = toolMatch[1];
        toolParams = [];
        toolResponse = [];
        inParams = true;
        inResponse = false;
        continue;
      }
      
      // Tool completion
      if (line.match(/●\s+Completed\s+in\s+[\d.]+[ms|s]/)) {
        inParams = false;
        inResponse = false;
        continue;
      }
      
      // Response start (usually after parameters)
      if (line.includes('Response:') || line.includes('Result:')) {
        inParams = false;
        inResponse = true;
        continue;
      }
      
      // Collect parameters
      if (inParams && line && !line.startsWith('●')) {
        toolParams.push(line);
      }
      
      // Collect response
      if (inResponse && line && !line.startsWith('●')) {
        toolResponse.push(line);
      }
    }
    
    // Save last tool if exists
    if (currentTool) {
      this.toolCalls.push({
        tool: currentTool,
        parameters: toolParams.join('\n'),
        response: toolResponse.join('\n'),
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Save MCP logs to files for debugging
   */
  saveMCPLogs() {
    const outputDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Save raw output
    const rawOutputFile = path.join(outputDir, 'amazonq-raw-output.log');
    fs.writeFileSync(rawOutputFile, this.rawOutput);
    
    // Save MCP server logs
    const mcpLogsFile = path.join(outputDir, 'mcp-server-logs.json');
    fs.writeFileSync(mcpLogsFile, JSON.stringify(this.mcpLogs, null, 2));
    
    // Save tool calls
    const toolCallsFile = path.join(outputDir, 'mcp-tool-calls.json');
    fs.writeFileSync(toolCallsFile, JSON.stringify(this.toolCalls, null, 2));
    
    // Create human-readable summary
    const summaryFile = path.join(outputDir, 'mcp-interaction-summary.md');
    this.createMCPSummary(summaryFile);
    
    // Log summary to GitHub Actions
    core.info(`MCP Interaction Summary:`);
    core.info(`- MCP Server Events: ${this.mcpLogs.length}`);
    core.info(`- Tool Calls Made: ${this.toolCalls.length}`);
    core.info(`- Raw Output Size: ${this.rawOutput.length} chars`);
    
    if (this.toolCalls.length > 0) {
      core.info(`Tools Used: ${this.toolCalls.map(t => t.tool).join(', ')}`);
    }
  }

  /**
   * Create human-readable MCP interaction summary
   */
  createMCPSummary(summaryFile) {
    let summary = '# Amazon Q MCP Interaction Summary\n\n';
    
    summary += `**Generated:** ${new Date().toISOString()}\n\n`;
    
    // MCP Server Events
    if (this.mcpLogs.length > 0) {
      summary += '## MCP Server Events\n\n';
      for (const log of this.mcpLogs) {
        summary += `- **${log.type}** (${log.timestamp}): ${log.message}\n`;
      }
      summary += '\n';
    }
    
    // Tool Calls
    if (this.toolCalls.length > 0) {
      summary += '## Tool Calls\n\n';
      for (let i = 0; i < this.toolCalls.length; i++) {
        const call = this.toolCalls[i];
        summary += `### ${i + 1}. ${call.tool}\n\n`;
        summary += `**Timestamp:** ${call.timestamp}\n\n`;
        
        if (call.parameters) {
          summary += '**Parameters:**\n```json\n' + call.parameters + '\n```\n\n';
        }
        
        if (call.response) {
          summary += '**Response:**\n```\n' + call.response + '\n```\n\n';
        }
      }
    }
    
    // Raw output info
    summary += '## Raw Output Info\n\n';
    summary += `- Total characters: ${this.rawOutput.length}\n`;
    summary += `- Available in: amazonq-raw-output.log\n\n`;
    
    fs.writeFileSync(summaryFile, summary);
  }

  /**
   * Parse Amazon Q output and clean it
   * Use OutputCleaner to remove ANSI codes and tool execution blocks
   */
  parseOutput(output) {
    core.debug(`Amazon Q raw output: ${output.length} chars`);
    
    // Log MCP interactions before cleaning
    this.logMCPInteractions(output);

    const cleanOutput = this.outputCleaner.cleanAmazonQOutput(output);

    core.debug(`Amazon Q cleaned output: ${cleanOutput.length} chars`);

    return cleanOutput;
  }
}

module.exports = { AmazonQCLIExecutor };
