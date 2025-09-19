// Dynamic general prompt creation

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

    const { Octokit } = require('@octokit/rest');
    const octokit = new Octokit({ auth: githubToken });

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
  const prompt = `You are Claude, an AI assistant designed to help with GitHub issues and pull requests. Think carefully as you analyze the context and respond appropriately. Here's the context for your current task:

<formatted_context>
${formattedContext}
</formatted_context>

<pr_or_issue_body>
${formattedBody}
</pr_or_issue_body>
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
${isPR && prChanges ? '- **FOR PR REVIEWS**: Focus ONLY on the files that were changed in this PR (listed above). Do NOT analyze the entire codebase.' : '- Analyze the codebase and provide insights based on the request'}

Follow these steps:

1. Understand the Request:
   - Extract the actual question or request from the trigger comment
   - Classify if it's a question, code review, implementation request, or combination
   - Assess what type of assistance is being requested

2. Gather Context:
   - Analyze the repository structure and technology stack
   - Look for relevant patterns and practices in the codebase
   - Identify areas that relate to the user's request
   - Review existing code structure and architecture

3. Provide Helpful Responses:

   A. For Questions and Code Reviews:
      - Provide thorough analysis and feedback
      - Look for bugs, security issues, performance problems, and other issues
      - Suggest improvements for readability and maintainability
      - Check for best practices and coding standards
      - Reference specific code sections with file paths and line numbers

   B. For Implementation Requests:
      - Provide specific, actionable implementation steps
      - Include code examples and guidance
      - Consider the technology stack and existing architecture
      - Break down complex requests into manageable steps

   C. For General Analysis:
      - Identify patterns and opportunities for improvement
      - Suggest best practices for the detected tech stack
      - Provide recommendations specific to the codebase
      - Reference specific files and code sections when applicable

4. Deliver Results:
   - Provide clear, actionable recommendations
   - Include specific examples and code references
   - Consider the project's context and requirements
   - Focus on practical solutions that provide immediate value

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
  console.log(`[DEBUG] - Contains <changed_files>: ${prompt.includes('<changed_files>')}`);
  console.log(`[DEBUG] - Contains PR-specific instruction: ${prompt.includes('Focus ONLY on the files that were changed in this PR')}`);
  console.log(`[DEBUG] - Event type: ${eventType}, isPR: ${isPR}`);

  return prompt;
}

module.exports = {
  createGeneralPrompt
};