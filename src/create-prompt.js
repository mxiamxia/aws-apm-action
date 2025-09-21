// Dynamic general prompt creation

/**
 * Get the trigger time from the GitHub context (following claude-code-action pattern)
 */
function getTriggerTime(context) {
  if (context.eventName === 'issue_comment') {
    return context.payload.comment?.created_at;
  } else if (context.eventName === 'pull_request_review') {
    return context.payload.review?.submitted_at;
  } else if (context.eventName === 'pull_request_review_comment') {
    return context.payload.comment?.created_at;
  }
  return undefined;
}

/**
 * Filters comments to only include those that existed in their final state before the trigger time.
 * This prevents malicious actors from editing comments after the trigger to inject harmful content.
 * (Following claude-code-action security pattern)
 */
function filterCommentsToTriggerTime(comments, triggerTime) {
  if (!triggerTime) return comments;

  const triggerTimestamp = new Date(triggerTime).getTime();

  return comments.filter((comment) => {
    // Comment must have been created before trigger (not at or after)
    const createdTimestamp = new Date(comment.createdAt).getTime();
    if (createdTimestamp >= triggerTimestamp) {
      return false;
    }

    // If comment has been edited, the most recent edit must have occurred before trigger
    // Use updated_at as GitHub REST API doesn't provide lastEditedAt
    if (comment.updatedAt) {
      const lastEditTimestamp = new Date(comment.updatedAt).getTime();
      if (lastEditTimestamp >= triggerTimestamp) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Get comments for conversation context (following claude-code-action pattern with security filtering)
 */
async function getConversationComments(context, githubToken) {
  try {
    if (!githubToken) {
      console.warn('No GitHub token provided for fetching comments');
      return [];
    }

    const github = require('@actions/github');
    const octokit = github.getOctokit(githubToken);

    console.log(`[DEBUG] Fetching conversation comments for ${context.eventName}`);

    // Get trigger time for security filtering
    const triggerTime = getTriggerTime(context);
    console.log(`[DEBUG] Trigger time for security filtering: ${triggerTime}`);

    let comments = [];

    if (context.eventName === 'issue_comment' || context.eventName === 'issues') {
      // Get issue comments
      const { data: issueComments } = await octokit.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.issue?.number || context.payload.pull_request?.number,
      });

      comments = issueComments.map(comment => ({
        author: comment.user.login,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        body: comment.body,
        isMinimized: false // GitHub API doesn't provide this, assume false
      }));

    } else if (context.eventName === 'pull_request_review_comment' || context.eventName === 'pull_request_review') {
      // Get PR comments (issue comments on PRs)
      const { data: issueComments } = await octokit.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
      });

      // Get PR review comments
      const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.payload.pull_request.number,
      });

      // Combine and sort by creation time
      const allComments = [
        ...issueComments.map(comment => ({
          author: comment.user.login,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          body: comment.body,
          type: 'issue_comment',
          isMinimized: false
        })),
        ...reviewComments.map(comment => ({
          author: comment.user.login,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          body: comment.body,
          type: 'review_comment',
          isMinimized: false
        }))
      ];

      // Sort by creation time
      comments = allComments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }

    // Apply security filtering to prevent malicious comment editing
    const filteredComments = filterCommentsToTriggerTime(comments, triggerTime);
    const filteredCount = comments.length - filteredComments.length;

    if (filteredCount > 0) {
      console.log(`[DEBUG] Security filtering removed ${filteredCount} comments that were created or edited after trigger time`);
    }

    console.log(`[DEBUG] Retrieved ${filteredComments.length} comments for conversation context (${comments.length} total, ${filteredCount} filtered)`);
    return filteredComments;

  } catch (error) {
    console.error('Could not fetch conversation comments:', error.message);
    console.log('[DEBUG] GitHub API error details:', error.status || 'No status', error.response?.data?.message || 'No error message');
    return [];
  }
}

/**
 * Format comments for conversation context (following claude-code-action pattern)
 */
function formatConversationComments(comments) {
  if (!comments || comments.length === 0) {
    return "No previous comments";
  }

  return comments
    .filter(comment => !comment.isMinimized)
    .map(comment => {
      // Sanitize content (basic implementation)
      const sanitizedBody = comment.body || '';
      const formattedDate = new Date(comment.createdAt).toISOString();
      return `[${comment.author} at ${formattedDate}]: ${sanitizedBody}`;
    })
    .join('\n\n');
}

/**
 * Get PR changed files if this is a PR context
 */
async function getPRChangedFiles(context, githubToken) {
  // Check for PR context in different event types
  const directPR = context.payload.pull_request;
  const issuePR = context.payload.issue?.pull_request;
  const isPRContext = !!(directPR || issuePR);

  console.log(`[DEBUG] Checking for PR context:`);
  console.log(`[DEBUG] - payload.pull_request exists: ${!!directPR}`);
  console.log(`[DEBUG] - payload.issue.pull_request exists: ${!!issuePR}`);
  console.log(`[DEBUG] - Overall PR context: ${isPRContext}`);

  if (!isPRContext) {
    console.log('[DEBUG] Not a PR context, skipping changed files fetch');
    return null;
  }

  // Get PR number from whichever source is available
  const prNumber = directPR?.number || (issuePR ? context.payload.issue.number : null);

  if (!prNumber) {
    console.log('[DEBUG] No PR number found, skipping changed files fetch');
    return null;
  }

  try {
    if (!githubToken) {
      console.warn('No GitHub token provided for PR diff');
      return null;
    }

    console.log(`[DEBUG] Fetching PR changes for PR #${prNumber}`);

    // Use @actions/github instead of direct @octokit/rest to avoid ES module issues
    const github = require('@actions/github');
    const octokit = github.getOctokit(githubToken);

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
    });

    console.log(`[DEBUG] Successfully fetched ${files.length} changed files from PR`);
    console.log(`[DEBUG] Changed files: ${files.map(f => f.filename).join(', ')}`);

    const mappedFiles = files.map(file => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch
    }));

    return mappedFiles;
  } catch (error) {
    console.error('Could not fetch PR changes:', error.message);
    console.log('[DEBUG] GitHub API error details:', error.status || 'No status', error.response?.data?.message || 'No error message');

    // Return null to continue without PR changes rather than failing completely
    return null;
  }
}

/**
 * Create a general prompt based on GitHub context, following claude-code-action pattern
 */
async function createGeneralPrompt(context, repoInfo, userRequest = '', githubToken = null) {
  const { eventName, payload } = context;

  // Detect PR context correctly for different event types
  const directPR = payload.pull_request;
  const issuePR = payload.issue?.pull_request;
  const isPR = !!(directPR || issuePR);

  console.log(`[DEBUG] === NEW PR DETECTION LOGIC ACTIVE ===`);
  console.log(`[DEBUG] PR detection in createGeneralPrompt:`);
  console.log(`[DEBUG] - payload.pull_request: ${!!directPR}`);
  console.log(`[DEBUG] - payload.issue.pull_request: ${!!issuePR}`);
  console.log(`[DEBUG] - Final isPR: ${isPR}`);

  const repository = context.repo.owner + '/' + context.repo.repo;

  // Extract trigger context and event type
  let eventType = '';
  let triggerContext = '';
  let commentBody = '';

  if (eventName === 'issue_comment') {
    eventType = isPR ? 'GENERAL_COMMENT' : 'GENERAL_COMMENT';
    triggerContext = isPR ? "issue comment with trigger phrase" : "issue comment with trigger phrase";
    commentBody = payload.comment.body;
  } else if (eventName === 'pull_request_review_comment') {
    eventType = 'REVIEW_COMMENT';
    triggerContext = "PR review comment with trigger phrase";
    commentBody = payload.comment.body;
  } else if (eventName === 'pull_request_review') {
    eventType = 'PR_REVIEW';
    triggerContext = "PR review with trigger phrase";
    commentBody = payload.review.body || '';
  } else if (eventName === 'issues') {
    eventType = 'ISSUE_CREATED';
    triggerContext = "new issue with trigger phrase in body";
    commentBody = payload.issue.body || '';
  }

  // Build comprehensive repository context
  const formattedContext = `Repository: ${repository}
Primary Language: ${repoInfo.primaryLanguage}
Description: ${repoInfo.description || 'No description provided'}
Size: ${repoInfo.size} KB
File Count: ${repoInfo.fileCount}
Topics: ${repoInfo.topics.join(', ') || 'None'}`;

  const formattedBody = commentBody || userRequest || 'No description provided';

  // Get conversation context (following claude-code-action pattern)
  console.log(`[DEBUG] === FETCHING CONVERSATION CONTEXT ===`);
  const conversationComments = await getConversationComments(context, githubToken);
  const formattedComments = formatConversationComments(conversationComments);
  console.log(`[DEBUG] Conversation context: ${conversationComments.length} comments formatted`);

  // Get PR changes if this is a PR context
  console.log(`[DEBUG] === ABOUT TO FETCH PR CHANGES ===`);
  console.log(`[DEBUG] Attempting to fetch PR changes - isPR: ${isPR}`);
  console.log(`[DEBUG] GitHub token available: ${!!githubToken}`);
  const prChanges = await getPRChangedFiles(context, githubToken);
  console.log(`[DEBUG] PR changes result: ${prChanges ? `${prChanges.length} files` : 'null'}`);

  // Build changed files section for PR reviews
  let changedFilesSection = '';
  if (isPR && prChanges && prChanges.length > 0) {
    console.log(`[DEBUG] Building changed files section for ${prChanges.length} files`);
    changedFilesSection = `
<changed_files>
The following files were changed in this PR:

${prChanges.map(file => `
**${file.filename}** (${file.status})
- Additions: +${file.additions}
- Deletions: -${file.deletions}
${file.patch ? `
\`\`\`diff
${file.patch}
\`\`\`
` : ''}
`).join('\n')}
</changed_files>`;
    console.log(`[DEBUG] Changed files section created (${changedFilesSection.length} characters)`);
  } else {
    console.log(`[DEBUG] No changed files section created - isPR: ${isPR}, prChanges: ${!!prChanges}, length: ${prChanges?.length || 0}`);
  }

  // Follow claude-code-action's prompt structure for general use
  const prompt = `You are an AI assistant designed to help with GitHub issues and pull requests. Think carefully as you analyze the context and respond appropriately. Here's the context for your current task:

<formatted_context>
${formattedContext}
</formatted_context>

<pr_or_issue_body>
${formattedBody}
</pr_or_issue_body>

<comments>
${formattedComments}
</comments>
${changedFilesSection}

<event_type>${eventType}</event_type>
<is_pr>${isPR ? "true" : "false"}</is_pr>
<trigger_context>${triggerContext}</trigger_context>
<repository>${repository}</repository>
<trigger_phrase>@awsapm</trigger_phrase>

Your task is to analyze the context, understand the request, and provide helpful responses and/or implement code changes as needed.

IMPORTANT CLARIFICATIONS:
- When asked to "review" code, read the code and provide review feedback (do not implement changes unless explicitly asked)
- Your responses should be practical and implementation-focused
- **REPOSITORY SCOPE**: You are analyzing the repository "${repository}". Do NOT access or mention any files outside this repository, including action source code or system files.
${isPR && prChanges ? '- **FOR PR REVIEWS**: Focus ONLY on the files that were changed in this PR (listed above). Do NOT analyze the entire codebase.' : '- Analyze the codebase and provide insights based on the request'}

RESPONSE FORMAT REQUIREMENTS:
- Provide ONLY your final analysis, conclusions, and recommendations in a CONCISE format
- Be as brief as possible while maintaining clarity and usefulness
- Do NOT include process commentary like "Let me check...", "I'll help you...", "Now let me...", or "I can see that..."
- Do NOT describe your step-by-step investigation process or tool usage
- Do NOT mention creating todo lists or updating tracking items
- Do NOT mention which AI agent or tool you are (e.g., Claude Code, Amazon Q, etc.) - refer to yourself generically as "AI Agent" if needed
- Do NOT include any tool usage details, permission requests, or internal system messages
- Do NOT show JSON blocks, API calls, or technical execution details
- Focus on delivering actionable insights and concrete findings in the shortest possible format
- Use bullet points, short sentences, and clear headings
- Aim for maximum information density with minimum words

Follow these steps:

1. Understand the Request:
   - Extract the actual question or request from the trigger comment
   - Classify if it's a question, code review, implementation request, or combination
   - Assess what type of assistance is being requested

2. Gather Context:
   - Analyze the pre-fetched conversation history in the <comments> section above
   - Review the repository structure and technology stack
   - Look for relevant patterns and practices in the codebase
   - Identify areas that relate to the user's request
   - Review existing code structure and architecture
   - Consider previous conversations and context from earlier comments

3. Provide Helpful Responses:

   A. For Questions and Code Reviews:
      - Provide thorough analysis and feedback
      - Look for bugs, security issues, performance problems, and other issues
      - Suggest improvements for readability and maintainability
      - Check for best practices and coding standards
      - Reference specific code sections with file paths and line numbers

   B. For Implementation Requests:
      - Analyze what needs to be implemented and provide specific recommendations
      - ONLY implement code changes if the user explicitly asks for a "fix", "implementation", or "create PR"
      - If implementing: Edit files locally using Edit/MultiEdit tools, then use GitHub MCP tools to create PRs
      - Follow existing code patterns and conventions
      - Test your changes if possible

   C. For General Analysis:
      - Identify patterns and opportunities for improvement
      - Suggest best practices for the detected tech stack
      - Provide recommendations specific to the codebase
      - Reference specific files and code sections when applicable

4. When to Create Pull Requests:
   ONLY create pull requests and implement code changes if the user explicitly requests:
   - "fix this"
   - "implement this"
   - "create a PR"
   - "make the changes"

   Otherwise, provide analysis and recommendations only.

   If user explicitly requests implementation:
   Step 1: Create branch (mcp__github__create_branch)
   Step 2: Update files (mcp__github__create_or_update_file)
   Step 3: Create PR (mcp__github__create_pull_request)

5. Deliver Results:
   - Keep responses SHORT and CONCISE
   - Use bullet points and brief sentences
   - Focus on key findings and actionable next steps
   - Avoid lengthy explanations unless specifically requested
   - Maximum 3-5 main points per response

CAPABILITIES:
What You CAN Do:
- Analyze repository structure and code patterns
- Provide detailed code reviews and feedback
- Answer questions about code and provide explanations
- Suggest implementations and improvements
- Review code for bugs, performance, and best practices

What You FOCUS On:
- Understanding the user's specific request
- Providing practical, actionable advice
- Code quality and best practices
- Technology-specific recommendations
- Clear explanations and examples

Provide practical, actionable recommendations specific to this repository's technology stack and use case.`;

  // Debug log the final prompt characteristics
  console.log(`[DEBUG] Final prompt generated:`);
  console.log(`[DEBUG] - Total length: ${prompt.length} characters`);
  console.log(`[DEBUG] - Contains <comments>: ${prompt.includes('<comments>')}`);
  console.log(`[DEBUG] - Contains <changed_files>: ${prompt.includes('<changed_files>')}`);
  console.log(`[DEBUG] - Contains PR-specific instruction: ${prompt.includes('Focus ONLY on the files that were changed in this PR')}`);
  console.log(`[DEBUG] - Event type: ${eventType}, isPR: ${isPR}`);
  console.log(`[DEBUG] - Conversation comments count: ${conversationComments.length}`);

  return prompt;
}

module.exports = {
  createGeneralPrompt
};