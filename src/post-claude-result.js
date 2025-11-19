#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

/**
 * Post Claude Code execution results back to GitHub issue/PR
 * This is specifically for the Claude Code path when using claude-code-base-action
 */
async function run() {
  try {
    // Get inputs from environment
    const commentId = process.env.AWSAPM_COMMENT_ID;
    const executionFile = process.env.CLAUDE_EXECUTION_FILE;
    const githubToken = process.env.GITHUB_TOKEN;
    const repository = process.env.REPOSITORY;
    const conclusion = process.env.CLAUDE_CONCLUSION || 'unknown';

    if (!commentId) {
      core.info('No comment ID provided - skipping result posting');
      return;
    }

    if (!executionFile || !fs.existsSync(executionFile)) {
      core.warning(`Execution file not found: ${executionFile}`);

      // Post error message to GitHub
      const octokit = github.getOctokit(githubToken);
      const [owner, repo] = repository.split('/');

      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body: `❌ **Investigation Failed**\n\nClaude Code execution file not found. Check the [workflow logs](${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}) for details.`
      });
      return;
    }

    // Read Claude Code execution log
    core.info(`Reading Claude execution results from: ${executionFile}`);
    const executionLogContent = fs.readFileSync(executionFile, 'utf8');

    // Debug: Print FULL execution file content
    core.info(`========== FULL EXECUTION FILE CONTENT START ==========`);
    core.info(executionLogContent);
    core.info(`========== FULL EXECUTION FILE CONTENT END ==========`);
    core.info(`Total file length: ${executionLogContent.length} characters`);

    // Parse the execution log (JSON format from claude-code-base-action)
    let result = '';
    try {
      const lines = executionLogContent.split('\n').filter(line => line.trim());
      let lastAssistantMessage = '';

      core.info(`Processing ${lines.length} lines from execution log`);

      // Parse stream-json format output
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);

          // Debug: Log what types we're seeing
          if (parsed.type) {
            core.info(`Found JSON with type: ${parsed.type}`);
          }

          // Extract text from assistant messages
          if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
            let currentMessage = '';
            for (const content of parsed.message.content) {
              if (content.type === 'text' && content.text) {
                currentMessage += content.text;
              }
            }
            if (currentMessage.trim()) {
              lastAssistantMessage = currentMessage;
            }
          }

          // Extract final result
          if (parsed.type === 'result' && parsed.result) {
            result += parsed.result;
          }
        } catch (e) {
          // Skip non-JSON lines
        }
      }

      // Use the last assistant message if no explicit result
      result = result || lastAssistantMessage;

    } catch (parseError) {
      core.error(`Failed to parse execution log: ${parseError.message}`);
      result = executionLogContent; // Fallback to raw content
    }

    if (!result || result.trim().length === 0) {
      result = '⚠️ Investigation completed but no result was generated. Check the workflow logs for details.';
    }

    // Debug: Log what we're posting
    core.info(`Result length: ${result.length} characters`);
    core.info(`First 500 chars of result: ${result.substring(0, 500)}`);

    // Post result to GitHub
    const octokit = github.getOctokit(githubToken);
    const [owner, repo] = repository.split('/');

    const statusEmoji = conclusion === 'success' ? '✅' : '⚠️';
    const commentBody = `${statusEmoji} **Application Observability for AWS Assistant Result**\n\n${result}`;

    core.info(`Updating comment ${commentId} in ${owner}/${repo}`);
    core.info(`Comment body length: ${commentBody.length} characters`);

    const response = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body: commentBody
    });

    core.info(`Successfully posted Claude results to GitHub (comment URL: ${response.data.html_url})`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to post Claude results: ${errorMessage}`);
    core.setFailed(`Failed to post Claude results: ${errorMessage}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
