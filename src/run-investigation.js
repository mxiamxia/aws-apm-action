#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
// Note: createGeneralPrompt is now called in prepare.js

/**
 * Build allowed tools string for Claude CLI investigation
 */
function buildAllowedToolsString() {
  // Get the working directory (target repository) to restrict access
  // The working directory should be the checked-out repository, not the action directory
  const workingDir = process.env.GITHUB_WORKSPACE || process.cwd();
  console.log(`[DEBUG] Target repository working directory: ${workingDir}`);
  console.log(`[DEBUG] Current working directory: ${process.cwd()}`);
  console.log(`[DEBUG] Action path: ${process.env.GITHUB_ACTION_PATH || 'undefined'}`);

  // Essential tools for repository investigation - RESTRICTED to target repository only
  const allowedTools = [
    `Read(${workingDir}/**)`,           // Read repository files only
    `Edit(${workingDir}/**)`,           // Edit existing files in repository only (for local editing)
    `MultiEdit(${workingDir}/**)`,      // Multi-edit files in repository only (for local editing)
    `Glob(${workingDir}/**)`,           // Find files in repository only
    `Grep(${workingDir}/**)`,           // Search through repository code only
    "Bash(git status:*)",               // Git repository status
    "Bash(git log:*)",                  // Git history
    "Bash(git diff:*)",                 // View changes
    "Bash(git show:*)",                 // Show commits/files
    "Bash(git checkout:*)",             // Switch branches
    "Bash(git branch:*)",               // Branch operations
    `Bash(ls:${workingDir}/**)`,        // List repository contents only
    `Bash(find:${workingDir}/**)`,      // Find files in repository only
    `Bash(cat:${workingDir}/**)`,       // Read repository files only
    `Bash(head:${workingDir}/**)`,      // Read repository file headers only
    `Bash(tail:${workingDir}/**)`,      // Read repository file tails only
    `Bash(wc:${workingDir}/**)`,        // Word/line counts in repository only
  ];

  // Add GitHub MCP tools (using official GitHub MCP server following claude-code-action pattern)
  // These work through GitHub API and avoid permission prompts
  allowedTools.push(
    "mcp__github__*",                      // Allow all GitHub MCP tools (wildcard)
    "mcp__github__create_pull_request",    // Create pull requests
    "mcp__github__create_or_update_file",  // Create or update files via GitHub API
    "mcp__github__push_files",             // Push files via GitHub API
    "mcp__github__get_file",               // Get file contents
    "mcp__github__create_branch",          // Create branches
    "mcp__github__list_files",             // List repository files
    "mcp__github__get_file_contents"       // Get file contents (additional specific name)
  );

  // Add AWS CloudWatch AppSignals MCP tools (if AWS credentials are available)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    const awsMcpTools = [
      "mcp__*",  // Allow all MCP tools (broader pattern)
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__*",  // Specific AppSignals wildcard with underscores
      // Exact tool names with underscores format (as shown in your example)
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__list_monitored_services",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__get_service_detail",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__list_slis",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__get_slo",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__search_Transaction_spans",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__search_transaction_spans",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__query_sampled_traces",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__query_service_metrics",
    ];
    allowedTools.push(...awsMcpTools);
    console.log('Added AWS CloudWatch AppSignals MCP tools to allowed tools');
    console.log(`[DEBUG] MCP tools added: ${awsMcpTools.join(', ')}`);
  } else {
    console.log('[DEBUG] AWS credentials not available, skipping MCP tools');
  }

  const allowedToolsString = allowedTools.join(",");
  console.log(`[DEBUG] Final allowed tools string: ${allowedToolsString}`);
  return allowedToolsString;
}

/**
 * Create MCP configuration file for AWS CloudWatch AppSignals
 */
function createMCPConfig() {
  try {
    const mcpConfig = {
      mcpServers: {}
    };

    // Add AWS CloudWatch AppSignals MCP server if credentials are available
    const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const awsRegion = process.env.AWS_REGION || 'us-east-1';

    if (awsAccessKeyId && awsSecretAccessKey) {
      console.log('AWS credentials found, setting up MCP server for CloudWatch AppSignals...');
      mcpConfig.mcpServers["awslabs.cloudwatch-appsignals-mcp-server"] = {
        command: "uvx",
        args: ["awslabs.cloudwatch-appsignals-mcp-server@latest"],
        env: {
          aws_access_key_id: awsAccessKeyId,
          aws_secret_access_key: awsSecretAccessKey,
          AWS_REGION: awsRegion
        }
      };
      console.log(`AWS MCP server configured for region: ${awsRegion}`);
    } else {
      console.log('No AWS credentials found, skipping AWS MCP server');
    }

    // Add GitHub MCP server if GitHub token is available (following claude-code-action pattern)
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      console.log('GitHub token found, setting up GitHub MCP server...');
      mcpConfig.mcpServers.github = {
        command: "docker",
        args: [
          "run",
          "-i",
          "--rm",
          "-e",
          "GITHUB_PERSONAL_ACCESS_TOKEN",
          "-e",
          "GITHUB_HOST",
          "ghcr.io/github/github-mcp-server:sha-efef8ae"
        ],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
          GITHUB_HOST: process.env.GITHUB_SERVER_URL || "https://github.com"
        }
      };
      console.log('GitHub MCP server configured');
    } else {
      console.log('No GitHub token found, skipping GitHub MCP server');
    }

    // Only create config if we have at least one server
    if (Object.keys(mcpConfig.mcpServers).length === 0) {
      console.log('No MCP servers to configure');
      return null;
    }

    // Create MCP config in temp directory (outside of repository)
    const tempDir = process.env.RUNNER_TEMP || '/tmp';
    const mcpConfigPath = path.join(tempDir, '.mcp.json');
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
    console.log(`MCP configuration created at: ${mcpConfigPath}`);
    console.log('MCP Config:', JSON.stringify(mcpConfig, null, 2));

    return mcpConfigPath;
  } catch (error) {
    console.warn(`MCP setup failed (Claude CLI will continue without MCP): ${error.message}`);
    return null;
  }
}

/**
 * Run Amazon Q Developer CLI investigation and prepare results for Claude
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
      // Get repository info for context
      const repoInfo = await getRepositoryInfo();

      if (useClaude) {
        console.log('Running Claude Code CLI investigation...');
        investigationResult = await runClaudeCodeCLI(promptContent);
        console.log('Claude Code CLI investigation completed');
      } else {
        console.log('Running Amazon Q Developer CLI investigation...');
        investigationResult = await runAmazonQDeveloperCLI(promptContent, repoInfo, context);
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

/**
 * Get basic repository information for investigation
 */
async function getRepositoryInfo() {
  try {
    const context = github.context;
    const githubToken = process.env.GITHUB_TOKEN;

    if (!githubToken) {
      throw new Error('GitHub token not available');
    }

    const octokit = github.getOctokit(githubToken);

    // Get repository information
    const repo = await octokit.rest.repos.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    // Get repository contents to count files and detect languages
    let fileCount = 0;
    let languages = {};

    try {
      const contents = await octokit.rest.repos.getContent({
        owner: context.repo.owner,
        repo: context.repo.repo,
        path: '',
      });

      if (Array.isArray(contents.data)) {
        fileCount = contents.data.filter(item => item.type === 'file').length;
      }

      // Get languages
      const languagesResponse = await octokit.rest.repos.listLanguages({
        owner: context.repo.owner,
        repo: context.repo.repo,
      });
      languages = languagesResponse.data;
    } catch (error) {
      console.warn('Could not fetch repository contents:', error.message);
    }

    const primaryLanguage = Object.keys(languages)[0] || 'Unknown';

    return {
      name: repo.data.name,
      description: repo.data.description,
      fileCount,
      primaryLanguage,
      languages,
      size: repo.data.size,
      topics: repo.data.topics || [],
    };
  } catch (error) {
    console.warn('Could not fetch repository info:', error.message);
    return {
      name: 'Unknown',
      description: 'Could not fetch repository information',
      fileCount: 0,
      primaryLanguage: 'Unknown',
      languages: {},
      size: 0,
      topics: [],
    };
  }
}

/**
 * Run Claude Code CLI using claude-code-action's proven named pipe approach
 */
async function runClaudeCodeCLI(promptContent) {
  const { spawn } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(require('child_process').exec);

  try {
    console.log('Executing Claude Code CLI commands...');

    // Use the prompt content that was already generated in prepare.js
    const claudePrompt = promptContent;
    console.log(`[DEBUG] Using pre-generated prompt (${claudePrompt.length} characters)`);

    // Test if claude command is available
    try {
      execSync('claude --help', {
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      });
    } catch (testError) {
      throw new Error('Claude Code CLI not found in PATH');
    }

    console.log('Claude Code CLI found, running investigation...');

    // Write the prompt to temp directory (outside of repository)
    const tempDir = process.env.RUNNER_TEMP || '/tmp';
    const tempPromptFile = path.join(tempDir, 'claude-prompt.txt');
    const PIPE_PATH = path.join(tempDir, 'claude_prompt_pipe');

    fs.writeFileSync(tempPromptFile, claudePrompt);

    console.log(`Prompt file size: ${claudePrompt.length} bytes`);
    console.log(`Running Claude with prompt from file: ${tempPromptFile}`);

    // Setup MCP configuration for AWS CloudWatch AppSignals if credentials are available
    const mcpConfigPath = createMCPConfig();

    // Build allowed tools for investigation
    const allowedTools = buildAllowedToolsString();
    console.log(`Allowed tools: ${allowedTools}`);

    // Build Claude CLI arguments (following claude-code-action pattern)
    const claudeArgs = [
      '-p',  // Will use named pipe instead of file
      '--verbose',
      '--output-format', 'stream-json',
      '--allowed-tools', allowedTools
    ];

    // Add MCP config if it was created and is valid
    if (mcpConfigPath && fs.existsSync(mcpConfigPath)) {
      claudeArgs.push('--mcp-config', mcpConfigPath);
      console.log(`Using MCP configuration: ${mcpConfigPath}`);
    }

    console.log(`Full command: claude ${claudeArgs.join(' ')}`);

    // Check authentication
    if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      throw new Error('No authentication provided. Either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required.');
    }

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      console.log('Claude CLI will use CLAUDE_CODE_OAUTH_TOKEN for authentication');
    } else if (process.env.ANTHROPIC_API_KEY) {
      console.log('Claude CLI will use ANTHROPIC_API_KEY for authentication');
    }

    // Create named pipe (following claude-code-action approach)
    try {
      await execAsync(`rm -f "${PIPE_PATH}"`);
    } catch (e) {
      // Ignore if file doesn't exist
    }

    await execAsync(`mkfifo "${PIPE_PATH}"`);
    console.log(`Created named pipe: ${PIPE_PATH}`);

    // Ensure Claude runs from the target repository directory
    const targetRepoDir = process.env.GITHUB_WORKSPACE || process.cwd();
    console.log(`[DEBUG] Executing Claude from directory: ${targetRepoDir}`);

    // Start sending prompt to pipe in background
    const catProcess = spawn('cat', [tempPromptFile], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const pipeWriteStream = require('fs').createWriteStream(PIPE_PATH);
    catProcess.stdout.pipe(pipeWriteStream);

    catProcess.on('error', (error) => {
      console.error('Error reading prompt file:', error);
      pipeWriteStream.destroy();
    });

    // Start Claude process
    console.log('Starting Claude process with named pipe...');
    const claudeProcess = spawn('claude', claudeArgs, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: targetRepoDir,
      env: {
        ...process.env,
        // Ensure non-interactive mode
        CLAUDE_NON_INTERACTIVE: '1',
        // Ensure GitHub Action inputs are available to Claude
        GITHUB_ACTION_INPUTS: process.env.INPUT_ACTION_INPUTS_PRESENT || '1'
      }
    });

    // Handle Claude process errors
    claudeProcess.on('error', (error) => {
      console.error('Error spawning Claude process:', error);
      pipeWriteStream.destroy();
      throw error;
    });

    // Capture output for parsing execution metrics (like claude-code-action)
    let output = '';
    claudeProcess.stdout.on('data', (data) => {
      const text = data.toString();

      // Try to parse as JSON and pretty print if it's on a single line (like claude-code-action)
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        if (line.trim() === '') return;

        try {
          // Check if this line is a JSON object
          const parsed = JSON.parse(line);
          const prettyJson = JSON.stringify(parsed, null, 2);
          process.stdout.write(prettyJson);
          if (index < lines.length - 1 || text.endsWith('\n')) {
            process.stdout.write('\n');
          }
        } catch (e) {
          // Not a JSON object, print as is
          process.stdout.write(line);
          if (index < lines.length - 1 || text.endsWith('\n')) {
            process.stdout.write('\n');
          }
        }
      });

      output += text;
    });

    // Handle stdout errors
    claudeProcess.stdout.on('error', (error) => {
      console.error('Error reading Claude stdout:', error);
    });

    // Pipe from named pipe to Claude
    const pipeReadProcess = spawn('cat', [PIPE_PATH]);
    pipeReadProcess.stdout.pipe(claudeProcess.stdin);

    // Handle pipe process errors
    pipeReadProcess.on('error', (error) => {
      console.error('Error reading from named pipe:', error);
      claudeProcess.kill('SIGTERM');
    });

    // Wait for Claude to finish (NO TIMEOUT - let it run as long as needed like claude-code-action)
    const exitCode = await new Promise((resolve) => {
      claudeProcess.on('close', (code) => {
        resolve(code || 0);
      });

      claudeProcess.on('error', (error) => {
        console.error('Claude process error:', error);
        resolve(1);
      });
    });

    // Clean up processes
    try {
      catProcess.kill('SIGTERM');
    } catch (e) {
      // Process may already be dead
    }
    try {
      pipeReadProcess.kill('SIGTERM');
    } catch (e) {
      // Process may already be dead
    }

    // Clean up files
    try {
      await execAsync(`rm -f "${PIPE_PATH}"`);
      if (fs.existsSync(tempPromptFile)) {
        fs.unlinkSync(tempPromptFile);
      }
      if (mcpConfigPath && fs.existsSync(mcpConfigPath)) {
        fs.unlinkSync(mcpConfigPath);
        console.log('Cleaned up MCP configuration file');
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    if (exitCode === 0) {
      console.log('Claude CLI completed successfully');

      // Parse the stream-json output to extract the final result (like claude-code-action does)
      const responseLines = output.split('\n').filter(line => line.trim());
      let finalResponse = '';

      // Look for the final result in the JSON stream
      for (const line of responseLines) {
        try {
          const parsed = JSON.parse(line);

          // Extract text from assistant messages
          if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
            for (const content of parsed.message.content) {
              if (content.type === 'text' && content.text) {
                finalResponse += content.text + '\n\n';
              }
            }
          }

          // Extract final result
          if (parsed.type === 'result' && parsed.result) {
            finalResponse += parsed.result;
          }
        } catch (e) {
          // Skip non-JSON lines
        }
      }

      return finalResponse.trim() || 'AI Agent investigation completed, but no output was generated.';
    } else {
      throw new Error(`Claude CLI exited with code ${exitCode}`);
    }

  } catch (error) {
    throw new Error(`Claude Code CLI execution failed: ${error.message}`);
  }
}

/**
 * Run Amazon Q Developer CLI with actual commands
 */
async function runAmazonQDeveloperCLI(promptContent, repoInfo, context) {
  try {
    console.log('Executing Amazon Q Developer CLI commands...');

    // Create general prompt using dynamic generation
    const fullPrompt = await createGeneralPrompt(context, repoInfo, promptContent);

    // Try to run Amazon Q Developer CLI commands
    let qOutput = '';

    try {
      // Method 1: Try using q chat command directly
      console.log('Attempting to use Amazon Q Developer CLI...');

      // Test if q command is available
      execSync('q --help', {
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      });

      console.log('Amazon Q CLI found, running investigation...');

      // Run the actual investigation with q chat command
      const investigationCommand = `q chat --no-interactive --trust-all-tools "${fullPrompt.replace(/"/g, '\\"')}"`;
      qOutput = execSync(investigationCommand, {
        encoding: 'utf8',
        timeout: 180000, // 3 minutes timeout for investigation
        stdio: 'pipe'
      });

      console.log('Amazon Q CLI investigation completed successfully');

    } catch (qError) {
      console.log('Amazon Q CLI not available or failed');
      console.log('Q CLI Error:', qError.message);

      // Return simple error message
      qOutput = `❌ **AI Agent Investigation Error**

**Error:** ${qError.message}

**Possible causes:**
- Required CLI tool is not installed or not in PATH
- AWS credentials are not configured properly
- Network connectivity issues

**To fix:** Ensure required tools are installed and credentials are configured.

**Manual command:** \`q chat --no-interactive --trust-all-tools "Analyze this repository for AWS APM opportunities"\``;
    }

    // Log the output length for debugging
    console.log(`Amazon Q CLI output length: ${qOutput ? qOutput.length : 0} characters`);

    return qOutput || 'AI Agent investigation completed, but no output was generated.';

  } catch (error) {
    throw new Error(`Amazon Q Developer CLI execution failed: ${error.message}`);
  }
}



if (require.main === module) {
  run();
}

module.exports = { run };