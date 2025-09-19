#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Run Amazon Q Developer CLI analysis and prepare results for Claude
 */
async function run() {
  try {
    console.log('Starting AWS APM analysis...');

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

    // Run CLI analysis based on the selected tool
    let analysisResult = '';
    const useClaude = process.env.USE_CLAUDE === 'true';

    try {
      // Get repository info for context
      const repoInfo = await getRepositoryInfo();

      if (useClaude) {
        console.log('Running Claude Code CLI analysis...');
        analysisResult = await runClaudeCodeCLI(promptContent, repoInfo);
        console.log('Claude Code CLI analysis completed');
      } else {
        console.log('Running Amazon Q Developer CLI analysis...');
        analysisResult = await runAmazonQDeveloperCLI(promptContent, repoInfo);
        console.log('Amazon Q Developer CLI analysis completed');
      }
    } catch (error) {
      console.error(`${useClaude ? 'Claude Code CLI' : 'Amazon Q Developer CLI'} failed:`, error.message);

      // Get basic repo info for fallback
      const repoInfo = await getRepositoryInfo();
      analysisResult = `${useClaude ? 'Claude Code CLI' : 'Amazon Q Developer CLI'} analysis encountered an issue: ${error.message}\n\n` +
        `Fallback analysis for repository: ${context.repo.owner}/${context.repo.repo}\n` +
        `Files analyzed: ${repoInfo.fileCount}\n` +
        `Primary language: ${repoInfo.primaryLanguage}\n` +
        `Request: ${promptContent}`;
    }

    // Save analysis results
    const resultFile = path.join(outputDir, 'analysis-result.txt');
    fs.writeFileSync(resultFile, analysisResult);

    // Use Claude to enhance the response if API key is available, otherwise use Amazon Q results directly
    let finalResponse;
    if (process.env.ANTHROPIC_API_KEY) {
      console.log('Enhancing results with Claude...');
      finalResponse = await generateClaudeResponse(analysisResult, promptContent);
    } else {
      console.log('Using Amazon Q Developer CLI results directly...');
      finalResponse = formatAmazonQResponse(analysisResult, promptContent);
    }

    // Save the final response
    const responseFile = path.join(outputDir, 'awsapm-response.txt');
    fs.writeFileSync(responseFile, finalResponse);

    // Set outputs
    core.setOutput('execution_file', responseFile);
    core.setOutput('conclusion', 'success');
    core.setOutput('analysis_result', analysisResult);
    core.setOutput('final_response', finalResponse);

    console.log('Analysis and response generation completed');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Analysis failed: ${errorMessage}`);
    core.setFailed(`Analysis failed with error: ${errorMessage}`);

    // Still try to set some outputs for error handling
    core.setOutput('conclusion', 'failure');
    core.setOutput('error_message', errorMessage);

    process.exit(1);
  }
}

/**
 * Get basic repository information for analysis
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
async function runClaudeCodeCLI(promptContent, repoInfo) {
  try {
    console.log('Executing Claude Code CLI commands...');

    // Create a comprehensive prompt for Claude Code
    const claudePrompt = `You are an AWS APM (Application Performance Monitoring) expert assistant.

User Request: ${promptContent}

Please analyze this repository and provide:
1. Performance monitoring recommendations specific to this codebase
2. AWS services that would improve observability (X-Ray, CloudWatch, etc.)
3. Code patterns that may impact performance
4. Specific implementation steps for APM integration
5. Monitoring best practices for the detected technology stack

Focus on actionable recommendations using AWS monitoring services.`;

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

    console.log('Claude Code CLI found, running analysis...');

    // Write the prompt to a temporary file (following claude-code-action pattern)
    const tempPromptFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'claude-prompt.txt');
    fs.writeFileSync(tempPromptFile, claudePrompt);

    console.log(`Prompt file size: ${claudePrompt.length} bytes`);
    console.log(`Running Claude with prompt from file: ${tempPromptFile}`);

    // Run Claude Code CLI following claude-code-action pattern:
    // claude -p [prompt-file] --verbose --output-format stream-json
    const claudeArgs = [
      '-p', tempPromptFile,
      '--verbose',
      '--output-format', 'stream-json'
    ];

    console.log(`Full command: claude ${claudeArgs.join(' ')}`);

    // Check authentication before running
    if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      throw new Error('No authentication provided. Either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required.');
    }

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      console.log('Using CLAUDE_CODE_OAUTH_TOKEN for authentication');
    } else if (process.env.ANTHROPIC_API_KEY) {
      console.log('Using ANTHROPIC_API_KEY for authentication');
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
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN
        }
      });

      console.log('Claude CLI completed successfully with execSync');

      // Clean up temp file
      if (fs.existsSync(tempPromptFile)) {
        fs.unlinkSync(tempPromptFile);
      }

      // Parse the stream-json output to extract the actual response
      const responseLines = claudeOutput.split('\n').filter(line => line.trim());
      let finalResponse = '';

      for (const line of responseLines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'text' && parsed.text) {
            finalResponse += parsed.text;
          }
        } catch (e) {
          // Skip non-JSON lines
        }
      }

      return finalResponse || claudeOutput || 'Claude Code CLI analysis completed, but no output was generated.';

    } catch (execError) {
      console.error('execSync failed, trying spawn approach...', execError.message);

      // Fall back to spawn approach if execSync fails
      const claudeProcess = spawn('claude', claudeArgs, {
        stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr too
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN
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

      // Clean up temp file
      if (fs.existsSync(tempPromptFile)) {
        fs.unlinkSync(tempPromptFile);
      }

      if (exitCode === 0) {
        console.log('Claude Code CLI analysis completed successfully');

        // Parse the stream-json output to extract the actual response
        const responseLines = output.split('\n').filter(line => line.trim());
        let finalResponse = '';

        for (const line of responseLines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'text' && parsed.text) {
              finalResponse += parsed.text;
            }
          } catch (e) {
            // Skip non-JSON lines
          }
        }

        return finalResponse || output || 'Claude Code CLI analysis completed, but no output was generated.';
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
async function runAmazonQDeveloperCLI(promptContent, repoInfo) {
  try {
    console.log('Executing Amazon Q Developer CLI commands...');

    // Create a comprehensive prompt for Amazon Q CLI
    const fullPrompt = `I need you to analyze this repository for AWS Application Performance Monitoring (APM) opportunities.

Repository Information:
- Name: ${repoInfo.name}
- Primary Language: ${repoInfo.primaryLanguage}
- Repository Size: ${repoInfo.size} KB
- File Count: ${repoInfo.fileCount}

User Request: ${promptContent}

Please analyze the current directory and provide:
1. Performance monitoring recommendations specific to this codebase
2. AWS services that would improve observability
3. Code patterns that may impact performance
4. Specific implementation steps for APM integration
5. Monitoring best practices for the detected technology stack

Focus on actionable recommendations using AWS X-Ray, CloudWatch, and other AWS monitoring services.`;

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

      console.log('Amazon Q CLI found, running analysis...');

      // Run the actual analysis with q chat command
      const analysisCommand = `q chat --no-interactive --trust-all-tools "${fullPrompt.replace(/"/g, '\\"')}"`;
      qOutput = execSync(analysisCommand, {
        encoding: 'utf8',
        timeout: 180000, // 3 minutes timeout for analysis
        stdio: 'pipe'
      });

      console.log('Amazon Q CLI analysis completed successfully');

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

    return qOutput || 'Amazon Q Developer CLI analysis completed, but no output was generated.';

  } catch (error) {
    throw new Error(`Amazon Q Developer CLI execution failed: ${error.message}`);
  }
}


/**
 * Format Amazon Q Developer CLI results for direct use
 */
function formatAmazonQResponse(analysisResult, promptContent) {
  return `# 🔍 AWS APM Analysis Results

## Request Analysis
**Original Request:** ${promptContent}

## Amazon Q Developer CLI Analysis
${analysisResult}

---

### 🚀 Quick Actions You Can Take:

1. **Set up CloudWatch Metrics** - Monitor key application performance indicators
2. **Enable AWS X-Ray** - Add distributed tracing for better visibility
3. **Configure CloudWatch Alarms** - Get notified when performance degrades
4. **Review Code Patterns** - Look for performance bottlenecks in the analysis above

### 📊 Recommended AWS Services:
- **CloudWatch**: Application and infrastructure monitoring
- **X-Ray**: Distributed tracing and service maps
- **CloudTrail**: API call logging and auditing
- **AWS Config**: Resource configuration monitoring

*Analysis powered by Amazon Q Developer CLI*`;
}

/**
 * Generate Claude response based on the analysis
 */
async function generateClaudeResponse(analysisResult, promptContent) {
  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    if (!anthropicApiKey) {
      throw new Error('Anthropic API key not provided');
    }

    // Import node-fetch dynamically
    const fetch = await import('node-fetch').then(module => module.default);

    const claudePrompt = `You are an AWS APM expert assistant. Based on the following analysis from Amazon Q Developer CLI, provide a helpful response to the user.

Original user request: ${promptContent}

Analysis results:
${analysisResult}

Please provide a clear, actionable response that addresses the user's request and incorporates the analysis findings. Format your response in Markdown for better readability.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: claudePrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error('Invalid response from Claude API');
    }

    return data.content[0].text;

  } catch (error) {
    console.error('Claude API failed:', error.message);

    // Fallback response
    return `# AWS APM Analysis Results

I've completed the analysis using Amazon Q Developer CLI. Here are the findings:

${analysisResult}

---

*Note: This response was generated as a fallback due to Claude API unavailability. The analysis results above contain the core findings from Amazon Q Developer CLI.*`;
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };