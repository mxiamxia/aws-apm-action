#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

/**
 * Prepare the Application observability for AWS action by checking trigger conditions and creating initial tracking comment
 */
async function run() {
  try {
    console.log('Starting Application observability for AWS Action prepare step...');

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

    // Function to check for "@awsapm" trigger phrase
    function containsTriggerPhrase(text) {
      if (!text) return false;
      return text.includes('@awsapm');
    }

    // Check if trigger phrase is present in the event
    let containsTrigger = false;
    let triggerText = '';
    let commentId = null;
    let issueNumber = null;
    let isPR = false;

    if (context.eventName === 'issue_comment') {
      const comment = payload.comment;
      if (comment && comment.body && containsTriggerPhrase(comment.body)) {
        containsTrigger = true;
        triggerText = comment.body;
        commentId = comment.id;
        issueNumber = payload.issue.number;
        isPR = !!payload.issue.pull_request;
      }
    } else if (context.eventName === 'pull_request_review_comment') {
      const comment = payload.comment;
      if (comment && comment.body && containsTriggerPhrase(comment.body)) {
        containsTrigger = true;
        triggerText = comment.body;
        commentId = comment.id;
        issueNumber = payload.pull_request.number;
        isPR = true;
      }
    } else if (context.eventName === 'issues') {
      const issue = payload.issue;
      if (issue && ((issue.body && containsTriggerPhrase(issue.body)) ||
                    (issue.title && containsTriggerPhrase(issue.title)))) {
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

    // Setup GitHub token with intelligent resolution (including GitHub App support)
    let githubToken = process.env.OVERRIDE_GITHUB_TOKEN;
    let tokenSource = 'custom';

    // Check for GitHub App authentication
    if (!githubToken && process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY) {
      console.log('[INFO] GitHub App credentials detected, generating installation token...');
      try {
        githubToken = await generateGitHubAppToken();
        tokenSource = 'github_app';
      } catch (error) {
        console.error('Failed to generate GitHub App token:', error.message);
        console.log('Falling back to default workflow token...');
      }
    }

    if (!githubToken) {
      githubToken = process.env.DEFAULT_WORKFLOW_TOKEN;
      tokenSource = 'default';
    }

    if (!githubToken) {
      throw new Error('GitHub token is required');
    }

    // Provide helpful information about bot name behavior
    if (tokenSource === 'default') {
      console.log('[INFO] Using default GitHub token - comments will appear as "github-actions bot"');
      console.log('[INFO] To use a custom bot name, provide either:');
      console.log('[INFO]   1. github_token input with a token from your desired bot account');
      console.log('[INFO]   2. github_app_id + github_app_private_key for GitHub App authentication');
    } else if (tokenSource === 'github_app') {
      console.log('[INFO] Using GitHub App token - comments will appear as your custom bot');
    } else {
      console.log('[INFO] Using custom GitHub token - bot name depends on token source');
    }

    // Create Octokit instance
    const octokit = github.getOctokit(githubToken);

    // Check user permissions
    const hasPermissions = await checkUserPermissions(octokit, context, commentId, issueNumber);
    if (!hasPermissions) {
      console.log('User lacks permissions, exiting gracefully');
      core.setOutput('contains_trigger', 'false');
      return;
    }

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
    const awsapmBranch = `${branchPrefix}${context.runId}-${timestamp}`;

    console.log(`Base branch: ${actualBaseBranch}`);
    console.log(`Application observability for AWS branch: ${awsapmBranch}`);

    // Create initial tracking comment
    let awsapmCommentId = null;
    if (issueNumber) {
      try {
        const commentBody = `🔍 **Application observability for AWS Investigation Started**\n\n` +
          `I'm analyzing this ${isPR ? 'PR' : 'issue'} with AI Agent...\n\n` +
          `⏳ Investigation in progress - [View workflow run](${context.payload.repository.html_url}/actions/runs/${context.runId})\n\n` +
          `Branch: \`${awsapmBranch}\`\n\n` +
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

    // Generate dynamic prompt using createGeneralPrompt function
    console.log('Generating dynamic prompt with PR-specific context...');
    console.log(`[DEBUG] Context info - eventName: ${context.eventName}, isPR: ${isPR}`);

    // Get repository info for prompt generation
    console.log('[DEBUG] Fetching repository information...');
    let repoInfo;
    try {
      repoInfo = await getBasicRepoInfo(context, githubToken);
      console.log(`[DEBUG] Repository info: ${repoInfo.primaryLanguage}, ${repoInfo.description?.substring(0, 50) || 'No description'}...`);
    } catch (repoError) {
      console.warn('Failed to fetch repository info, using defaults:', repoError.message);
      repoInfo = {
        primaryLanguage: 'Unknown',
        description: 'Repository information unavailable',
        size: 0,
        fileCount: 'Unknown',
        topics: []
      };
    }

    // Use the dynamic prompt generation with PR context
    const { createGeneralPrompt } = require('./prompt-builder');
    console.log('[DEBUG] Calling createGeneralPrompt...');

    try {
      const finalPrompt = await createGeneralPrompt(context, repoInfo, prompt, githubToken);
      console.log(`[DEBUG] Generated prompt length: ${finalPrompt.length} characters`);

      fs.writeFileSync(promptFile, finalPrompt);
      console.log(`Created dynamic prompt file: ${promptFile}`);
    } catch (promptError) {
      console.error('Failed to generate dynamic prompt:', promptError.message);
      console.log('Falling back to basic prompt generation...');

      // Fallback to basic prompt if dynamic generation fails
      let fallbackPrompt = '';
      if (prompt) {
        fallbackPrompt = prompt + '\n\n';
      }
      fallbackPrompt += `Please analyze this ${isPR ? 'pull request' : 'issue'} using AI Agent for insights.\n\n`;
      fallbackPrompt += `Original request: ${triggerText}\n\n`;
      fallbackPrompt += `Context: This is a ${context.eventName} event in ${context.repo.owner}/${context.repo.repo}`;

      fs.writeFileSync(promptFile, fallbackPrompt);
      console.log(`Created fallback prompt file: ${promptFile}`);
    }

    // Set outputs
    console.log(`[DEBUG] Setting GITHUB_TOKEN output: ${githubToken ? 'Token available' : 'No token'}`);
    core.setOutput('GITHUB_TOKEN', githubToken);
    core.setOutput('AWSAPM_BRANCH', awsapmBranch);
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

/**
 * Check if user has write or admin permissions to the repository
 */
async function checkUserPermissions(octokit, context, commentId, issueNumber) {
  const actor = context.actor;
  console.log(`Checking permissions for actor: ${actor}`);

  try {
    // Check if the actor is a GitHub App (bot user)
    if (actor.endsWith('[bot]')) {
      console.log(`Actor is a GitHub App: ${actor}`);
      return true;
    }

    // Check permissions directly using the permission endpoint
    const response = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      username: actor,
    });

    const permissionLevel = response.data.permission;
    console.log(`Permission level retrieved: ${permissionLevel}`);

    if (permissionLevel === 'admin' || permissionLevel === 'write') {
      console.log(`Actor has write access: ${permissionLevel}`);
      return true;
    } else {
      console.log(`Actor has insufficient permissions: ${permissionLevel}`);
      
      // Post explanatory comment
      if (issueNumber) {
        try {
          const commentBody = `🚫 **Application observability for AWS Investigation - Access Denied**\n\n` +
            `Sorry @${actor}, you don't have sufficient permissions to use this bot.\n\n` +
            `**Required:** Write or Admin access to this repository\n` +
            `**Your level:** ${permissionLevel}\n\n` +
            `Please contact a repository maintainer if you believe this is an error.`;

          await octokit.rest.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issueNumber,
            body: commentBody,
          });
          console.log('Posted access denied comment');
        } catch (commentError) {
          console.error('Failed to post access denied comment:', commentError.message);
        }
      }
      
      return false;
    }
  } catch (error) {
    console.error(`Failed to check permissions: ${error}`);
    throw new Error(`Failed to check permissions for ${actor}: ${error}`);
  }
}

/**
 * Get basic repository information for prompt generation
 */
async function getBasicRepoInfo(context, githubToken) {
  try {
    const octokit = github.getOctokit(githubToken);

    const { data: repo } = await octokit.rest.repos.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    // Get repository languages
    const { data: languages } = await octokit.rest.repos.listLanguages({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    const primaryLanguage = Object.keys(languages)[0] || 'Unknown';

    return {
      primaryLanguage,
      description: repo.description,
      size: repo.size,
      fileCount: 'Unknown', // GitHub API doesn't provide file count directly
      topics: repo.topics || []
    };
  } catch (error) {
    console.warn('Could not fetch repository info:', error.message);
    return {
      primaryLanguage: 'Unknown',
      description: 'Repository information unavailable',
      size: 0,
      fileCount: 'Unknown',
      topics: []
    };
  }
}

/**
 * Generate GitHub App installation token using App ID and private key
 */
async function generateGitHubAppToken() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const context = github.context;

  console.log(`[DEBUG] GitHub App setup for repository: ${context.repo.owner}/${context.repo.repo}`);
  console.log(`[DEBUG] GitHub App ID: ${appId ? 'provided' : 'missing'}`);
  console.log(`[DEBUG] Private Key: ${privateKey ? 'provided' : 'missing'}`);

  if (!appId || !privateKey) {
    throw new Error('GitHub App ID and private key are required');
  }

  try {
    // Import jsonwebtoken for JWT creation
    const jwt = require('jsonwebtoken');

    // Create JWT for GitHub App authentication
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // Issued 1 minute in the past to allow for clock skew
      exp: now + (10 * 60), // Expires in 10 minutes
      iss: appId
    };

    console.log(`[DEBUG] Creating JWT token for App ID: ${appId}`);
    const jwtToken = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

    // Get installation ID for the current repository
    const appOctokit = github.getOctokit(jwtToken);

    console.log(`[DEBUG] Checking if GitHub App is installed on ${context.repo.owner}/${context.repo.repo}`);

    // First, let's check what installations this app has access to
    try {
      const { data: installations } = await appOctokit.rest.apps.listInstallations();
      console.log(`[DEBUG] GitHub App has ${installations.length} installation(s)`);

      for (const inst of installations) {
        console.log(`[DEBUG] Installation ${inst.id}: account=${inst.account.login}, type=${inst.account.type}`);
      }
    } catch (listError) {
      console.warn(`[DEBUG] Could not list installations: ${listError.message}`);
    }

    // Now try to get the specific repo installation
    const { data: installation } = await appOctokit.rest.apps.getRepoInstallation({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    console.log(`[DEBUG] Found installation ID: ${installation.id} for ${context.repo.owner}/${context.repo.repo}`);

    // Generate installation access token
    const { data: installationToken } = await appOctokit.rest.apps.createInstallationAccessToken({
      installation_id: installation.id,
    });

    console.log(`[INFO] Successfully generated GitHub App installation token for ${context.repo.owner}/${context.repo.repo}`);
    return installationToken.token;

  } catch (error) {
    console.error('GitHub App token generation error:', error.message);
    console.error(`[DEBUG] Error details:`, error.response?.data || 'No additional details');

    // Provide helpful troubleshooting information
    if (error.message.includes('Not Found')) {
      console.error(`[TROUBLESHOOTING] GitHub App is not installed on ${context.repo.owner}/${context.repo.repo}`);
      console.error(`[TROUBLESHOOTING] Please:`);
      console.error(`[TROUBLESHOOTING] 1. Go to your GitHub App settings`);
      console.error(`[TROUBLESHOOTING] 2. Click "Install App" and select the repository`);
      console.error(`[TROUBLESHOOTING] 3. Or check if the App ID (${appId}) is correct`);
    } else if (error.message.includes('Bad credentials')) {
      console.error(`[TROUBLESHOOTING] Invalid private key or App ID`);
      console.error(`[TROUBLESHOOTING] Please verify the private key matches App ID: ${appId}`);
    }

    throw new Error(`Failed to generate GitHub App token: ${error.message}`);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };