#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

/**
 * Update the GitHub comment with the final results from Application observability for AWS investigation
 */
async function run() {
  try {
    const context = github.context;

    // Get environment variables
    const githubToken = process.env.GITHUB_TOKEN;
    const repository = process.env.REPOSITORY;
    const awsapmCommentId = process.env.AWSAPM_COMMENT_ID;
    const githubRunId = process.env.GITHUB_RUN_ID;
    const awsapmSuccess = process.env.AWSAPM_SUCCESS === 'true';
    const outputFile = process.env.OUTPUT_FILE;
    const triggerUsername = process.env.TRIGGER_USERNAME;
    const prepareSuccess = process.env.PREPARE_SUCCESS === 'true';
    // Always use sticky comment behavior (removed as config, now always enabled)
    const useStickyComment = true;
    const issueNumber = process.env.PR_NUMBER;
    const isPR = process.env.IS_PR === 'true';
    
    // MCP logging files
    const mcpLogsFile = process.env.MCP_LOGS_FILE;
    const toolCallsFile = process.env.TOOL_CALLS_FILE;
    const mcpSummaryFile = process.env.MCP_SUMMARY_FILE;

    if (!githubToken) {
      throw new Error('GitHub token is required');
    }

    const octokit = github.getOctokit(githubToken);
    const [owner, repo] = repository.split('/');

    let responseContent = '';

    if (awsapmSuccess && outputFile && fs.existsSync(outputFile)) {
      // Read the AI response from the output file
      responseContent = fs.readFileSync(outputFile, 'utf8');
    } else {
      responseContent = '❌ **Investigation Failed**\n\nThe Application observability for AWS investigation could not be completed. Please check the workflow logs for more details.';
    }

    // Create the final comment body
    const workflowUrl = `${context.payload.repository.html_url}/actions/runs/${githubRunId}`;
    
    // Get MCP interaction summary if available
    let mcpSummary = '';
    if (mcpSummaryFile && fs.existsSync(mcpSummaryFile)) {
      try {
        const summaryContent = fs.readFileSync(mcpSummaryFile, 'utf8');
        // Extract just the tool calls section for the comment
        const toolCallsMatch = summaryContent.match(/## Tool Calls([\s\S]*?)(?=##|$)/);
        if (toolCallsMatch) {
          mcpSummary = `\n\n<details>\n<summary>🔧 MCP Tool Interactions (Click to expand)</summary>\n\n${toolCallsMatch[1].trim()}\n\n</details>`;
        }
      } catch (error) {
        core.warning(`Failed to read MCP summary: ${error.message}`);
      }
    }

    let commentBody;
    if (awsapmSuccess) {
      commentBody = `🎯 **Application observability for AWS Investigation Complete**\n\n` +
        `Investigation completed successfully! Here are the results:\n\n` +
        `---\n\n` +
        `${responseContent}\n\n` +
        `---\n\n` +
        `✅ **Status**: Complete\n` +
        `👤 **Requested by**: @${triggerUsername}\n` +
        `🔗 **Workflow**: [View details](${workflowUrl})\n` +
        `📊 **Artifacts**: [MCP Logs](${workflowUrl}#artifacts)${mcpSummary}\n\n` +
        `*Powered by AI Agent*`;
    } else {
      commentBody = `❌ **Application observability for AWS Investigation Failed**\n\n` +
        `The investigation could not be completed. Please check the workflow logs for more details.\n\n` +
        `👤 **Requested by**: @${triggerUsername}\n` +
        `🔗 **Workflow**: [View details](${workflowUrl})\n\n` +
        `*If this issue persists, please check your action configuration and try again.*`;
    }

    // Update or create comment
    if (awsapmCommentId && useStickyComment) {
      // Update existing comment
      try {
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: parseInt(awsapmCommentId),
          body: commentBody,
        });
      } catch (error) {
        core.error(`Failed to update existing comment: ${error.message}`);
        // Fall back to creating a new comment
        await createNewComment(octokit, owner, repo, issueNumber, commentBody);
      }
    } else {
      // Create new comment
      await createNewComment(octokit, owner, repo, issueNumber, commentBody);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Comment update failed: ${errorMessage}`);

    // Try to post an error comment if possible
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      const repository = process.env.REPOSITORY;
      const issueNumber = process.env.PR_NUMBER;

      if (githubToken && repository && issueNumber) {
        const octokit = github.getOctokit(githubToken);
        const [owner, repo] = repository.split('/');

        const errorCommentBody = `❌ **Application observability for AWS Action Error**\n\n` +
          `Failed to complete the investigation due to an internal error.\n\n` +
          `Error: \`${errorMessage}\`\n\n` +
          `Please check the [workflow logs](${context.payload.repository.html_url}/actions/runs/${process.env.GITHUB_RUN_ID}) for more details.`;

        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: parseInt(issueNumber),
          body: errorCommentBody,
        });
      }
    } catch (errorCommentError) {
      core.error(`Failed to post error comment: ${errorCommentError.message}`);
    }

    core.setFailed(`Comment update failed with error: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Create a new comment on the issue/PR
 */
async function createNewComment(octokit, owner, repo, issueNumber, commentBody) {
  if (!issueNumber) {
    return;
  }

  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: parseInt(issueNumber),
      body: commentBody,
    });
  } catch (error) {
    core.error(`Failed to create new comment: ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };