#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { ClaudeCLIExecutor } = require('./executors/claude-cli-executor');
const { AmazonQCLIExecutor } = require('./executors/amazonq-cli-executor');
// Note: createGeneralPrompt is now called in prepare.js

/**
 * Main entry point for AWS APM investigation
 */
async function run() {
  try {
    console.log('Starting AWS APM investigation...');

    const context = github.context;

    // Read the prompt file
    const promptFile = process.env.INPUT_PROMPT_FILE;
    if (!promptFile || !fs.existsSync(promptFile)) {
      throw new Error('Prompt file not found');
    }

    const promptContent = fs.readFileSync(promptFile, 'utf8');
    console.log('Prompt loaded successfully');
    console.log(`[DEBUG] Prompt content length: ${promptContent.length} characters`);
    console.log(`[DEBUG] Prompt contains <changed_files>: ${promptContent.includes('<changed_files>')}`);
    console.log(`[DEBUG] Prompt contains PR-specific instruction: ${promptContent.includes('Focus ONLY on the files that were changed in this PR')}`);

    // Check GitHub token availability
    console.log(`[DEBUG] GITHUB_TOKEN environment variable available: ${!!process.env.GITHUB_TOKEN}`);

    // Print the full prompt content for debugging
    console.log('\n=== FULL PROMPT CONTENT START ===');
    console.log(promptContent);
    console.log('=== FULL PROMPT CONTENT END ===\n');

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

    // Run CLI investigation based on the selected tool
    let investigationResult = '';
    const useClaude = process.env.USE_CLAUDE === 'true';

    try {
      if (useClaude) {
        console.log('Running Claude Code CLI investigation...');
        const executor = new ClaudeCLIExecutor();
        investigationResult = await executor.execute(promptContent);
        console.log('Claude Code CLI investigation completed');
      } else {
        console.log('Running Amazon Q Developer CLI investigation...');
        const executor = new AmazonQCLIExecutor();
        investigationResult = await executor.execute(promptContent);
        console.log('Amazon Q Developer CLI investigation completed');
      }
    } catch (error) {
      console.error(`${useClaude ? 'Claude Code CLI' : 'Amazon Q Developer CLI'} failed:`, error.message);

      // Return the actual error message - no fallback
      investigationResult = `❌ **AI Agent Investigation Failed**

**Error:** ${error.message}

**User Request:** ${promptContent}

Please check the workflow logs for more details and ensure proper authentication is configured.`;
    }

    // Save investigation results
    const resultFile = path.join(outputDir, 'investigation-result.txt');
    fs.writeFileSync(resultFile, investigationResult);

    // Use the investigation result directly - no enhancement needed
    let finalResponse;

    if (useClaude) {
      // Claude CLI mode - use the Claude CLI response directly
      console.log('Using Claude Code CLI results directly...');
      finalResponse = investigationResult;
    } else {
      // Amazon Q mode - use the Amazon Q results directly
      console.log('Using Amazon Q Developer CLI results directly...');
      finalResponse = investigationResult;
    }

    // Save the final response
    const responseFile = path.join(outputDir, 'awsapm-response.txt');
    fs.writeFileSync(responseFile, finalResponse);

    // Set outputs
    core.setOutput('execution_file', responseFile);
    core.setOutput('conclusion', 'success');
    core.setOutput('investigation_result', investigationResult);
    core.setOutput('final_response', finalResponse);

    console.log('Investigation and response generation completed');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Investigation failed: ${errorMessage}`);
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
