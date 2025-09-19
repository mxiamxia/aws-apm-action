#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createGeneralPrompt } = require('./create-prompt');

/**
 * Build allowed tools string for Claude CLI investigation
 */
function buildAllowedToolsString() {
  // Essential tools for repository investigation
  const allowedTools = [
    "Read",                    // Read repository files and prompt
    "Glob",                    // Find files by patterns
    "Grep",                    // Search through code
    "Bash(git status:*)",      // Git repository status
    "Bash(git log:*)",         // Git history
    "Bash(git diff:*)",        // View changes
    "Bash(git show:*)",        // Show commits/files
    "Bash(ls:*)",              // List directory contents
    "Bash(find:*)",            // Find files
    "Bash(cat:*)",             // Read file contents (alternative to Read)
    "Bash(head:*)",            // Read file headers
    "Bash(tail:*)",            // Read file tails
    "Bash(wc:*)",              // Word/line counts
  ];

  // Add AWS CloudWatch AppSignals MCP tools (if AWS credentials are available)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    const awsMcpTools = [
      "mcp__awslabs.cloudwatch-appsignals-mcp-server__*",  // All AppSignals MCP tools
    ];
    allowedTools.push(...awsMcpTools);
    console.log('Added AWS CloudWatch AppSignals MCP tools to allowed tools');
  }

  return allowedTools.join(",");
}

/**
 * Create MCP configuration file for AWS CloudWatch AppSignals
 */
function createMCPConfig() {
  try {
    const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const awsRegion = process.env.AWS_REGION || 'us-east-1';

    // Only create MCP config if AWS credentials are available
    if (awsAccessKeyId && awsSecretAccessKey) {
      console.log('AWS credentials found, setting up MCP server for CloudWatch AppSignals...');

      const mcpConfig = {
        mcpServers: {
          "awslabs.cloudwatch-appsignals-mcp-server": {
            command: "uvx",
            args: ["awslabs.cloudwatch-appsignals-mcp-server@latest"],
            env: {
              aws_access_key_id: awsAccessKeyId,
              aws_secret_access_key: awsSecretAccessKey,
              AWS_REGION: awsRegion
            }
          }
        }
      };

      // Create MCP config in temp directory (outside of repository)
      const tempDir = process.env.RUNNER_TEMP || '/tmp';
      const mcpConfigPath = path.join(tempDir, '.mcp.json');
      fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      console.log(`MCP configuration created at: ${mcpConfigPath}`);
      console.log(`AWS Region: ${awsRegion}`);

      return mcpConfigPath;
    } else {
      console.log('No AWS credentials found, skipping MCP server setup');
      return null;
    }
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
        investigationResult = await runClaudeCodeCLI(promptContent, repoInfo, context);
        console.log('Claude Code CLI investigation completed');
      } else {
        console.log('Running Amazon Q Developer CLI investigation...');
        investigationResult = await runAmazonQDeveloperCLI(promptContent, repoInfo, context);
        console.log('Amazon Q Developer CLI investigation completed');
      }
    } catch (error) {
      console.error(`${useClaude ? 'Claude Code CLI' : 'Amazon Q Developer CLI'} failed:`, error.message);

      // Return the actual error message - no fallback
      investigationResult = `❌ **${useClaude ? 'Claude Code CLI' : 'Amazon Q Developer CLI'} Failed**

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
 * Run Claude Code CLI (based on claude-code-action implementation)
 */
async function runClaudeCodeCLI(promptContent, repoInfo, context) {
  try {
    console.log('Executing Claude Code CLI commands...');

    // Create general prompt using dynamic generation
    const claudePrompt = createGeneralPrompt(context, repoInfo, promptContent);

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
    fs.writeFileSync(tempPromptFile, claudePrompt);

    console.log(`Prompt file size: ${claudePrompt.length} bytes`);
    console.log(`Running Claude with prompt from file: ${tempPromptFile}`);

    // Setup MCP configuration for AWS CloudWatch AppSignals if credentials are available
    const mcpConfigPath = createMCPConfig();

    // Build allowed tools for investigation
    const allowedTools = buildAllowedToolsString();
    console.log(`Allowed tools: ${allowedTools}`);

    // Run Claude Code CLI following claude-code-action pattern:
    // claude -p [prompt-file] --verbose --output-format stream-json [--mcp-config .mcp.json] --allowed-tools [tools]
    const claudeArgs = [
      '-p', tempPromptFile,
      '--verbose',
      '--output-format', 'stream-json',
      '--allowed-tools', allowedTools
    ];

    // Add MCP config if it was created and is valid
    if (mcpConfigPath) {
      try {
        // Verify the MCP config file exists and is readable
        if (fs.existsSync(mcpConfigPath)) {
          claudeArgs.push('--mcp-config', mcpConfigPath);
          console.log(`Using MCP configuration: ${mcpConfigPath}`);
        } else {
          console.warn('MCP config file not found, continuing without MCP');
        }
      } catch (error) {
        console.warn(`Error accessing MCP config file (continuing without MCP): ${error.message}`);
      }
    }

    console.log(`Full command: claude ${claudeArgs.join(' ')}`);

    // Check authentication before running (Claude CLI will auto-detect the auth method)
    if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      throw new Error('No authentication provided. Either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required.');
    }

    // Claude CLI will automatically use CLAUDE_CODE_OAUTH_TOKEN if available, otherwise ANTHROPIC_API_KEY
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      console.log('Claude CLI will use CLAUDE_CODE_OAUTH_TOKEN for authentication');
    } else if (process.env.ANTHROPIC_API_KEY) {
      console.log('Claude CLI will use ANTHROPIC_API_KEY for authentication');
    }

    // Use spawn for better control (following claude-code-action pattern)
    const { spawn } = require('child_process');

    console.log('Spawning Claude process...');

    // Try a simpler approach first - let's use execSync with timeout
    try {
      const { execSync } = require('child_process');

      console.log('Running Claude CLI with execSync...');
      const claudeOutput = execSync(`claude ${claudeArgs.join(' ')}`, {
        encoding: 'utf8',
        timeout: 180000, // 3 minutes timeout
        stdio: 'pipe',
        env: {
          ...process.env
        }
      });

      console.log('Claude CLI completed successfully with execSync');

      // Clean up temp files
      if (fs.existsSync(tempPromptFile)) {
        fs.unlinkSync(tempPromptFile);
      }
      if (mcpConfigPath && fs.existsSync(mcpConfigPath)) {
        fs.unlinkSync(mcpConfigPath);
        console.log('Cleaned up MCP configuration file');
      }

      // Parse the stream-json output to extract the final result (like claude-code-action does)
      const responseLines = claudeOutput.split('\n').filter(line => line.trim());
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

      return finalResponse.trim() || 'Claude Code CLI investigation completed, but no output was generated.';

    } catch (execError) {
      console.error('execSync failed, trying spawn approach...', execError.message);

      // Fall back to spawn approach if execSync fails
      const claudeProcess = spawn('claude', claudeArgs, {
        stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr too
        env: {
          ...process.env
        }
      });

      // Capture stderr for debugging
      let stderrOutput = '';
      claudeProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderrOutput += text;
        console.error('Claude stderr:', text);
      });

      // Handle process errors
      claudeProcess.on('error', (error) => {
        throw new Error(`Error spawning Claude process: ${error.message}`);
      });

      // Capture output
      let output = '';
      claudeProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;

        // Log each line for debugging (like claude-code-action does)
        const lines = text.split('\n');
        lines.forEach((line) => {
          if (line.trim() === '') return;

          try {
            // Try to parse as JSON and pretty print
            const parsed = JSON.parse(line);
            console.log(JSON.stringify(parsed, null, 2));
          } catch (e) {
            // Not JSON, print as is
            console.log(line);
          }
        });
      });

      // Wait for Claude to finish with timeout
      const exitCode = await new Promise((resolve) => {
        let processCompleted = false;

        // Set a timeout to prevent hanging
        const timeout = setTimeout(() => {
          if (!processCompleted) {
            console.error('Claude process timed out after 5 minutes');
            claudeProcess.kill('SIGTERM');
            resolve(1);
          }
        }, 300000); // 5 minutes timeout

        claudeProcess.on('close', (code) => {
          processCompleted = true;
          clearTimeout(timeout);
          resolve(code || 0);
        });

        claudeProcess.on('error', (error) => {
          processCompleted = true;
          clearTimeout(timeout);
          console.error('Claude process error:', error);
          resolve(1);
        });
      });

      // Clean up temp files
      if (fs.existsSync(tempPromptFile)) {
        fs.unlinkSync(tempPromptFile);
      }
      if (mcpConfigPath && fs.existsSync(mcpConfigPath)) {
        fs.unlinkSync(mcpConfigPath);
        console.log('Cleaned up MCP configuration file');
      }

      if (exitCode === 0) {
        console.log('Claude Code CLI investigation completed successfully');

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

        return finalResponse.trim() || 'Claude Code CLI investigation completed, but no output was generated.';
      } else {
        let errorMessage = `Claude Code CLI exited with code ${exitCode}`;
        if (stderrOutput) {
          errorMessage += `\nStderr output: ${stderrOutput}`;
        }
        if (output) {
          errorMessage += `\nStdout output: ${output.substring(0, 500)}...`; // First 500 chars
        }
        throw new Error(errorMessage);
      }
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
    const fullPrompt = createGeneralPrompt(context, repoInfo, promptContent);

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
      qOutput = `❌ **Amazon Q Developer CLI Error**

**Error:** ${qError.message}

**Possible causes:**
- Amazon Q CLI is not installed or not in PATH
- AWS credentials are not configured properly
- Network connectivity issues

**To fix:** Ensure Amazon Q CLI is installed and AWS credentials are configured.

**Manual command:** \`q chat --no-interactive --trust-all-tools "Analyze this repository for AWS APM opportunities"\``;
    }

    // Log the output length for debugging
    console.log(`Amazon Q CLI output length: ${qOutput ? qOutput.length : 0} characters`);

    return qOutput || 'Amazon Q Developer CLI investigation completed, but no output was generated.';

  } catch (error) {
    throw new Error(`Amazon Q Developer CLI execution failed: ${error.message}`);
  }
}



if (require.main === module) {
  run();
}

module.exports = { run };