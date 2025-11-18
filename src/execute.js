#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { AmazonQCLIExecutor } = require('./executors/amazonq-cli-executor');
const { ClaudeCLIExecutor } = require('./executors/claude-cli-executor');
const { OutputCleaner } = require('./utils/output-cleaner');

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

    // Print the full prompt content for debugging
    core.debug(promptContent);

    // Create output directory
    const outputDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Determine which CLI to use
    const cliTool = process.env.CLI_TOOL || 'amazon_q_cli';
    const useClaude = cliTool === 'claude_code';
    const cliName = useClaude ? 'Claude Code CLI' : 'Amazon Q Developer CLI';

    // Run investigation
    let investigationResult = '';

    try {
      core.info(`Running ${cliName} investigation...`);
      const executor = useClaude ? new ClaudeCLIExecutor(null) : new AmazonQCLIExecutor(null);
      investigationResult = await executor.execute(promptContent);
      core.info(`${cliName} investigation completed`);

      // Validate that we got a proper result (not the prompt echoed back)
      if (!investigationResult.includes('🎯 **Application observability for AWS Assistant Result**')) {
        core.warning(`${cliName} output does not contain the expected result marker`);
        throw new Error(`${cliName} did not return a valid investigation result`);
      }
    } catch (error) {
      core.error(`${cliName} failed: ${error.message}`);

      // Return a concise error message without the full prompt
      investigationResult = `❌ **Investigation Failed**

**Error:** ${error.message}

Please check the [workflow logs](${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}) for more details and ensure proper authentication is configured.`;
    }

    // Clean the output to ensure proper markdown formatting for GitHub
    const cleaner = new OutputCleaner();
    const cleanedResult = useClaude
      ? cleaner.cleanClaudeOutput(investigationResult)
      : cleaner.cleanAmazonQOutput(investigationResult);

    // Save the cleaned response with unique run ID to avoid conflicts on self-hosted runners
    const runId = process.env.GITHUB_RUN_ID || Date.now();
    const responseFile = path.join(outputDir, `awsapm-response-${runId}.txt`);
    fs.writeFileSync(responseFile, cleanedResult);

    // Set outputs
    core.setOutput('execution_file', responseFile);
    core.setOutput('conclusion', 'success');

    core.info('Investigation completed');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Investigation failed: ${errorMessage}`);
    core.setFailed(`Investigation failed with error: ${errorMessage}`);

    // Still try to set some outputs for error handling
    core.setOutput('conclusion', 'failure');
    core.setOutput('error_message', errorMessage);

    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
