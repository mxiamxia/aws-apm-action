#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

/**
 * Update the GitHub comment with the final results from AWS APM investigation and Claude response
 */
async function run() {
  try {
    console.log('Updating GitHub comment with results...');

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
    const useStickyComment = process.env.USE_STICKY_COMMENT === 'true';
    const issueNumber = process.env.PR_NUMBER;
    const isPR = process.env.IS_PR === 'true';

    if (!githubToken) {
      throw new Error('GitHub token is required');
    }

    const octokit = github.getOctokit(githubToken);
    const [owner, repo] = repository.split('/');

    console.log(`Repository: ${repository}`);
    console.log(`Issue/PR number: ${issueNumber}`);
    console.log(`Comment ID: ${awsapmCommentId}`);
    console.log(`Success: ${awsapmSuccess}`);

    let responseContent = '';

    if (awsapmSuccess && outputFile && fs.existsSync(outputFile)) {
      // Read the Claude response from the output file
      responseContent = fs.readFileSync(outputFile, 'utf8');
    } else {
      responseContent = '❌ **Investigation Failed**\n\nThe AWS APM investigation could not be completed. Please check the workflow logs for more details.';
    }

    // Create the final comment body
    const workflowUrl = `${context.payload.repository.html_url}/actions/runs/${githubRunId}`;

    let commentBody;
    if (awsapmSuccess) {
      commentBody = `🎯 **AWS APM Investigation Complete**\n\n` +
        `Investigation completed successfully! Here are the results:\n\n` +
        `---\n\n` +
        `${responseContent}\n\n` +
        `---\n\n` +
        `✅ **Status**: Complete\n` +
        `👤 **Requested by**: @${triggerUsername}\n` +
        `🔗 **Workflow**: [View details](${workflowUrl})\n\n` +
        `*Powered by Amazon Q Developer CLI via Claude bot*`;
    } else {
      commentBody = `❌ **AWS APM Investigation Failed**\n\n` +
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
        console.log(`Updated existing comment: ${awsapmCommentId}`);
      } catch (error) {
        console.error('Failed to update existing comment:', error.message);
        // Fall back to creating a new comment
        await createNewComment(octokit, owner, repo, issueNumber, commentBody);
      }
    } else {
      // Create new comment
      await createNewComment(octokit, owner, repo, issueNumber, commentBody);
    }

    console.log('Comment update completed successfully');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Comment update failed: ${errorMessage}`);

    // Try to post an error comment if possible
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      const repository = process.env.REPOSITORY;
      const issueNumber = process.env.PR_NUMBER;

      if (githubToken && repository && issueNumber) {
        const octokit = github.getOctokit(githubToken);
        const [owner, repo] = repository.split('/');

        const errorCommentBody = `❌ **AWS APM Action Error**\n\n` +
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
      console.error('Failed to post error comment:', errorCommentError.message);
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
    console.log('No issue number provided, skipping comment creation');
    return;
  }

  try {
    const comment = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: parseInt(issueNumber),
      body: commentBody,
    });
    console.log(`Created new comment: ${comment.data.id}`);
  } catch (error) {
    console.error('Failed to create new comment:', error.message);
    throw error;
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };