const { spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

/**
 * Base class for CLI executors
 * Implements common logic for running AI CLI tools with named pipes
 * Uses template method pattern - subclasses override specific methods
 */
class BaseCLIExecutor {
  constructor() {
    this.tempDir = process.env.RUNNER_TEMP || '/tmp';
    this.targetRepoDir = process.env.GITHUB_WORKSPACE || process.cwd();
  }

  /**
   * Get CLI-specific command name (must be overridden)
   * @returns {string} Command name (e.g., 'claude', 'q')
   */
  getCommandName() {
    throw new Error('getCommandName() must be implemented by subclass');
  }

  /**
   * Get CLI-specific command arguments (must be overridden)
   * @returns {Array<string>} Command arguments
   */
  getCommandArgs() {
    throw new Error('getCommandArgs() must be implemented by subclass');
  }

  /**
   * Get CLI-specific environment variables (must be overridden)
   * @returns {Object} Environment variables
   */
  getEnvironmentVariables() {
    return { ...process.env };
  }

  /**
   * Setup CLI-specific configuration (can be overridden)
   * @returns {Promise<string|null>} Configuration file path or null
   */
  async setupConfiguration() {
    // Default: no setup needed
    return null;
  }

  /**
   * Parse CLI output into final result (must be overridden)
   * @param {string} output Raw CLI output
   * @returns {string} Parsed result
   */
  parseOutput(output) {
    throw new Error('parseOutput() must be implemented by subclass');
  }

  /**
   * Get the working directory for CLI execution
   * @returns {string} Working directory path
   */
  getWorkingDirectory() {
    return this.targetRepoDir;
  }

  /**
   * Test if CLI command is available
   * @returns {Promise<boolean>} True if CLI is available
   */
  async testCLIAvailable() {
    const { execSync } = require('child_process');
    const commandName = this.getCommandName();

    try {
      execSync(`${commandName} --help`, {
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      });
      console.log(`${commandName} CLI found in PATH`);
      return true;
    } catch (error) {
      throw new Error(`${commandName} CLI not found in PATH`);
    }
  }

  /**
   * Create named pipe for large prompt input
   * @param {string} pipePath Path to named pipe
   */
  async createNamedPipe(pipePath) {
    const execAsync = promisify(require('child_process').exec);

    try {
      await execAsync(`rm -f "${pipePath}"`);
    } catch (e) {
      // Ignore if file doesn't exist
    }

    await execAsync(`mkfifo "${pipePath}"`);
    console.log(`Created named pipe: ${pipePath}`);
  }

  /**
   * Write prompt to temporary file
   * @param {string} promptContent Prompt content
   * @param {string} tempPromptFile Path to temp file
   */
  writePromptToFile(promptContent, tempPromptFile) {
    fs.writeFileSync(tempPromptFile, promptContent);
    console.log(`Prompt file size: ${promptContent.length} bytes`);
    console.log(`Prompt file: ${tempPromptFile}`);
  }

  /**
   * Start process to stream prompt file to pipe
   * @param {string} tempPromptFile Path to temp file
   * @param {string} pipePath Path to named pipe
   * @returns {{catProcess: ChildProcess, pipeWriteStream: WriteStream}}
   */
  startPromptStreaming(tempPromptFile, pipePath) {
    const catProcess = spawn('cat', [tempPromptFile], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const pipeWriteStream = fs.createWriteStream(pipePath);
    catProcess.stdout.pipe(pipeWriteStream);

    catProcess.on('error', (error) => {
      console.error('Error reading prompt file:', error);
      pipeWriteStream.destroy();
    });

    return { catProcess, pipeWriteStream };
  }

  /**
   * Spawn CLI process with provided configuration
   * @param {string} command CLI command name
   * @param {Array<string>} args Command arguments
   * @param {Object} env Environment variables
   * @param {string} cwd Working directory
   * @returns {ChildProcess} Spawned process
   */
  spawnCLIProcess(command, args, env, cwd) {
    console.log(`Full command: ${command} ${args.join(' ')}`);
    console.log(`Working directory: ${cwd}`);

    return spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: cwd,
      env: env
    });
  }

  /**
   * Pipe named pipe to CLI process stdin
   * @param {string} pipePath Path to named pipe
   * @param {ChildProcess} cliProcess CLI process
   * @returns {ChildProcess} Pipe read process
   */
  connectPipeToCLI(pipePath, cliProcess) {
    const pipeReadProcess = spawn('cat', [pipePath]);
    pipeReadProcess.stdout.pipe(cliProcess.stdin);

    pipeReadProcess.on('error', (error) => {
      console.error('Error reading from named pipe:', error);
      cliProcess.kill('SIGTERM');
    });

    return pipeReadProcess;
  }

  /**
   * Capture CLI process output
   * @param {ChildProcess} cliProcess CLI process
   * @returns {Promise<string>} Captured output
   */
  captureOutput(cliProcess) {
    return new Promise((resolve, reject) => {
      let output = '';

      cliProcess.stdout.on('data', (data) => {
        const text = data.toString();

        // Allow subclasses to customize output handling
        if (this.onOutputData) {
          this.onOutputData(text);
        } else {
          process.stdout.write(text);
        }

        output += text;
      });

      cliProcess.stdout.on('error', (error) => {
        console.error(`Error reading ${this.getCommandName()} stdout:`, error);
        reject(error);
      });

      cliProcess.on('close', (code) => {
        resolve({ output, exitCode: code || 0 });
      });

      cliProcess.on('error', (error) => {
        console.error(`${this.getCommandName()} process error:`, error);
        reject(error);
      });
    });
  }

  /**
   * Cleanup processes and files
   * @param {Array<ChildProcess>} processes Processes to kill
   * @param {Array<string>} files Files to delete
   */
  async cleanup(processes, files) {
    const execAsync = promisify(require('child_process').exec);

    // Cleanup processes
    for (const proc of processes) {
      try {
        if (proc && proc.kill) {
          proc.kill('SIGTERM');
        }
      } catch (e) {
        // Process may already be dead
      }
    }

    // Cleanup files
    for (const file of files) {
      try {
        if (file.includes('pipe')) {
          await execAsync(`rm -f "${file}"`);
        } else if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          if (file.includes('.mcp.json')) {
            console.log('Cleaned up MCP configuration file');
          }
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Main execution method - template method pattern
   * Orchestrates the entire CLI execution workflow
   * @param {string} promptContent Prompt content to execute
   * @returns {Promise<string>} Execution result
   */
  async execute(promptContent) {
    const commandName = this.getCommandName();

    try {
      console.log(`Executing ${commandName} CLI commands...`);
      console.log(`[DEBUG] Using pre-generated prompt (${promptContent.length} characters)`);

      // Test if CLI is available
      await this.testCLIAvailable();

      console.log(`${commandName} CLI found, running investigation...`);

      // Setup CLI-specific configuration
      const configPath = await this.setupConfiguration();

      // Prepare file paths
      const tempPromptFile = path.join(this.tempDir, `${commandName}-prompt.txt`);
      const pipePath = path.join(this.tempDir, `${commandName}_prompt_pipe`);

      // Write prompt to file
      this.writePromptToFile(promptContent, tempPromptFile);
      console.log(`Running ${commandName} with prompt from file: ${tempPromptFile}`);

      // Create named pipe
      await this.createNamedPipe(pipePath);

      // Ensure CLI runs from the target repository directory
      console.log(`[DEBUG] Executing ${commandName} from directory: ${this.targetRepoDir}`);

      // Start streaming prompt to pipe
      const { catProcess, pipeWriteStream } = this.startPromptStreaming(tempPromptFile, pipePath);

      // Get command args and env
      const args = this.getCommandArgs();
      const env = this.getEnvironmentVariables();

      // Spawn CLI process
      console.log(`Starting ${commandName} process with named pipe...`);
      const cliProcess = this.spawnCLIProcess(commandName, args, env, this.targetRepoDir);

      // Handle CLI process errors
      cliProcess.on('error', (error) => {
        console.error(`Error spawning ${commandName} process:`, error);
        pipeWriteStream.destroy();
        throw error;
      });

      // Connect pipe to CLI stdin
      const pipeReadProcess = this.connectPipeToCLI(pipePath, cliProcess);

      // Capture output and wait for completion (NO TIMEOUT)
      const { output, exitCode } = await this.captureOutput(cliProcess);

      // Cleanup processes and files
      const filesToClean = [pipePath, tempPromptFile];
      if (configPath) {
        filesToClean.push(configPath);
      }
      await this.cleanup([catProcess, pipeReadProcess], filesToClean);

      // Check exit code and parse output
      if (exitCode === 0) {
        console.log(`${commandName} CLI completed successfully`);
        const result = this.parseOutput(output.trim());
        return result || 'AI Agent investigation completed, but no output was generated.';
      } else {
        throw new Error(`${commandName} CLI exited with code ${exitCode}`);
      }

    } catch (error) {
      throw new Error(`${commandName} CLI execution failed: ${error.message}`);
    }
  }
}

module.exports = { BaseCLIExecutor };
