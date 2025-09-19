#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

/**
 * Prepare the AWS APM action by checking trigger conditions and creating initial tracking comment
 */
async function run() {
  try {
    console.log('Starting AWS APM Action prepare step...');

    // Get GitHub context
    const context = github.context;
    const payload = context.payload;

    console.log(`Event: ${context.eventName}`);
    console.log(`Repository: ${context.repo.owner}/${context.repo.repo}`);

    // Get inputs
    const triggerPhrase = process.env.TRIGGER_PHRASE || '@awsapm';
    const branchPrefix = process.env.BRANCH_PREFIX || 'awsapm/';
    const baseBranch = process.env.BASE_BRANCH || '';
    const allowedBots = process.env.ALLOWED_BOTS || '';
    const allowedNonWriteUsers = process.env.ALLOWED_NON_WRITE_USERS || '';
    const prompt = process.env.PROMPT || '';

    console.log(`Trigger phrase: ${triggerPhrase}`);

    // Check if trigger phrase is present in the event
    let containsTrigger = false;
    let triggerText = '';
    let commentId = null;
    let issueNumber = null;
    let isPR = false;

    if (context.eventName === 'issue_comment') {
      const comment = payload.comment;
      if (comment && comment.body && comment.body.includes(triggerPhrase)) {
        containsTrigger = true;
        triggerText = comment.body;
        commentId = comment.id;
        issueNumber = payload.issue.number;
        isPR = !!payload.issue.pull_request;
      }
    } else if (context.eventName === 'pull_request_review_comment') {
      const comment = payload.comment;
      if (comment && comment.body && comment.body.includes(triggerPhrase)) {
        containsTrigger = true;
        triggerText = comment.body;
        commentId = comment.id;
        issueNumber = payload.pull_request.number;
        isPR = true;
      }
    } else if (context.eventName === 'issues') {
      const issue = payload.issue;
      if (issue && ((issue.body && issue.body.includes(triggerPhrase)) ||
                    (issue.title && issue.title.includes(triggerPhrase)))) {
        containsTrigger = true;
        triggerText = issue.body || issue.title;
        issueNumber = issue.number;
        isPR = false;
      }
    }

    console.log(`Contains trigger: ${containsTrigger}`);

    // Set output for action.yml to check
    core.setOutput('contains_trigger', containsTrigger.toString());

    if (!containsTrigger) {
      console.log('No trigger found, skipping remaining steps');
      return;
    }

    // Setup GitHub token
    const githubToken = process.env.OVERRIDE_GITHUB_TOKEN || process.env.DEFAULT_WORKFLOW_TOKEN;
    if (!githubToken) {
      throw new Error('GitHub token is required');
    }

    // Create Octokit instance
    const octokit = github.getOctokit(githubToken);

    // Add immediate eye reaction to show the action is triggered
    if (commentId) {
      try {
        await octokit.rest.reactions.createForIssueComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: commentId,
          content: 'eyes',
        });
        console.log('Added eyes reaction to trigger comment');
      } catch (error) {
        console.warn('Failed to add reaction:', error.message);
      }
    }

    // Get repository default branch if not specified
    let actualBaseBranch = baseBranch;
    if (!actualBaseBranch) {
      const repo = await octokit.rest.repos.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
      });
      actualBaseBranch = repo.data.default_branch;
    }

    // Create branch name for this execution
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const claudeBranch = `${branchPrefix}${context.runId}-${timestamp}`;

    console.log(`Base branch: ${actualBaseBranch}`);
    console.log(`AWS APM branch: ${claudeBranch}`);

    // Create initial tracking comment
    let awsapmCommentId = null;
    if (issueNumber) {
      try {
        const commentBody = `🔍 **AWS APM Investigation Started**\n\n` +
          `I'm analyzing this ${isPR ? 'PR' : 'issue'} with AI Agent...\n\n` +
          `⏳ Investigation in progress - [View workflow run](${context.payload.repository.html_url}/actions/runs/${context.runId})\n\n` +
          `Branch: \`${claudeBranch}\`\n\n` +
          `*Powered by AI Agent*`;

        const comment = await octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          body: commentBody,
        });

        awsapmCommentId = comment.data.id;
        console.log(`Created tracking comment: ${awsapmCommentId}`);
      } catch (error) {
        console.error('Failed to create tracking comment:', error.message);
      }
    }

    // Create prompt file
    const promptDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-prompts');
    if (!fs.existsSync(promptDir)) {
      fs.mkdirSync(promptDir, { recursive: true });
    }

    const promptFile = path.join(promptDir, 'awsapm-prompt.txt');

    // Generate prompt based on the trigger text and custom prompt
    let finalPrompt = '';
    if (prompt) {
      finalPrompt = prompt + '\n\n';
    }
    finalPrompt += `Please analyze this ${isPR ? 'pull request' : 'issue'} using Amazon Q Developer CLI for APM insights.\n\n`;
    finalPrompt += `Original request: ${triggerText}\n\n`;
    finalPrompt += `Context: This is a ${context.eventName} event in ${context.repo.owner}/${context.repo.repo}`;

    fs.writeFileSync(promptFile, finalPrompt);
    console.log(`Created prompt file: ${promptFile}`);

    // Set outputs
    core.setOutput('github_token', githubToken);
    core.setOutput('AWSAPM_BRANCH', claudeBranch);
    core.setOutput('BASE_BRANCH', actualBaseBranch);
    core.setOutput('awsapm_comment_id', awsapmCommentId);
    core.setOutput('issue_number', issueNumber);
    core.setOutput('is_pr', isPR);
    core.setOutput('trigger_text', triggerText);

    console.log('Prepare step completed successfully');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Prepare step failed: ${errorMessage}`);
    core.setFailed(`Prepare step failed with error: ${errorMessage}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };