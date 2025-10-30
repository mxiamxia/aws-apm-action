#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { AmazonQCLIExecutor } = require('./executors/amazonq-cli-executor');
const { TimingTracker } = require('./utils/timing');

/**
 * Main entry point for Application observability for AWS investigation
 */
async function run() {
  try {
    core.info('Starting Application observability for AWS investigation...');

    const context = github.context;

    // Read the prompt file
    const promptFile = process.env.INPUT_PROMPT_FILE;
    if (!promptFile || !fs.existsSync(promptFile)) {
      throw new Error('Prompt file not found');
    }

    const promptContent = fs.readFileSync(promptFile, 'utf8');

    // Print the full prompt content for debugging (only in debug mode)
    if (process.env.RUNNER_DEBUG === '1') {
      core.debug('\n=== FULL PROMPT CONTENT START ===');
      core.debug(promptContent);
      core.debug('=== FULL PROMPT CONTENT END ===\n');
    }

    // Setup AWS credentials if provided
    if (process.env.AWS_ACCESS_KEY_ID) {
      process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
    }
    if (process.env.AWS_SECRET_ACCESS_KEY) {
      process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
    }
    if (process.env.AWS_SESSION_TOKEN) {
      process.env.AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
    }
    if (process.env.AWS_REGION) {
      process.env.AWS_REGION = process.env.AWS_REGION;
    }

    // Create output directory
    const outputDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Initialize timing tracker
    const timingTracker = new TimingTracker();

    // Run Amazon Q Developer CLI investigation
    let investigationResult = '';

    try {
      core.info('Running Amazon Q Developer CLI investigation...');
      const executor = new AmazonQCLIExecutor(timingTracker);
      investigationResult = await executor.execute(promptContent);
      core.info('Amazon Q Developer CLI investigation completed');
    } catch (error) {
      core.error(`Amazon Q Developer CLI failed: ${error.message}`);

      // Return the actual error message
      investigationResult = `❌ **Amazon Q Investigation Failed**

**Error:** ${error.message}

**User Request:** ${promptContent}

Please check the workflow logs for more details and ensure proper authentication is configured.`;
    }

    // Save investigation results
    const resultFile = path.join(outputDir, 'investigation-result.txt');
    fs.writeFileSync(resultFile, investigationResult);

    // Use the investigation result directly
    const finalResponse = investigationResult;

    // Save the final response
    const responseFile = path.join(outputDir, 'awsapm-response.txt');
    fs.writeFileSync(responseFile, finalResponse);

    // Save timing data
    const timingFile = path.join(outputDir, 'timing.json');
    timingTracker.save(timingFile);

    // Set outputs including MCP logs
    const mcpLogsFile = path.join(outputDir, 'mcp-server-logs.json');
    const toolCallsFile = path.join(outputDir, 'mcp-tool-calls.json');
    const summaryFile = path.join(outputDir, 'mcp-interaction-summary.md');
    
    core.setOutput('execution_file', responseFile);
    core.setOutput('mcp_logs_file', fs.existsSync(mcpLogsFile) ? mcpLogsFile : '');
    core.setOutput('tool_calls_file', fs.existsSync(toolCallsFile) ? toolCallsFile : '');
    core.setOutput('mcp_summary_file', fs.existsSync(summaryFile) ? summaryFile : '');
    core.setOutput('conclusion', 'success');
    core.setOutput('investigation_result', investigationResult);
    core.setOutput('final_response', finalResponse);

    core.info('Investigation completed');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Investigation failed: ${errorMessage}`);
    core.setFailed(`Investigation failed with error: ${errorMessage}`);

    // Still try to set some outputs for error handling
    const outputDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-output');
    const mcpLogsFile = path.join(outputDir, 'mcp-server-logs.json');
    const toolCallsFile = path.join(outputDir, 'mcp-tool-calls.json');
    
    core.setOutput('conclusion', 'failure');
    core.setOutput('error_message', errorMessage);
    core.setOutput('mcp_logs_file', fs.existsSync(mcpLogsFile) ? mcpLogsFile : '');
    core.setOutput('tool_calls_file', fs.existsSync(toolCallsFile) ? toolCallsFile : '');

    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
