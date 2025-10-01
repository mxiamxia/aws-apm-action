/**
 * Output cleaning and formatting utility for CLI outputs
 * Handles ANSI escape code removal and content filtering
 */
class OutputCleaner {
  /**
   * Remove ANSI escape codes from text
   * @param {string} text - Text containing ANSI codes
   * @returns {string} Cleaned text
   */
  removeAnsiCodes(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    return text
      .replace(/\x1b\[[0-9;]*[mGKHF]/g, '')  // Most common ANSI sequences
      .replace(/\u001b\[[0-9;]*[mGKHF]/g, '') // Unicode escape sequences
      .replace(/\x1b\[[0-9;]*[ABCD]/g, '')   // Cursor movement
      .replace(/\x1b\[[0-9;]*[JK]/g, '')     // Clear screen/line
      .replace(/�\[[0-9;]*[mGKHF]/g, '')     // Malformed sequences
      .replace(/�/g, '')                     // Remove any remaining replacement characters
      .trim();
  }

  /**
   * Remove tool execution blocks from CLI output
   * Removes content between "Using tool:" and "● Completed in"
   * @param {string} text - Text containing tool execution blocks
   * @returns {string} Cleaned text
   */
  removeToolExecutionBlocks(text) {
    const lines = text.split('\n');
    const filteredLines = [];
    let insideToolBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Start of tool execution block
      if (trimmed.match(/^🛠️\s*Using tool:/)) {
        insideToolBlock = true;
        continue;
      }

      // End of tool execution block
      if (insideToolBlock && trimmed.match(/^●\s*Completed in/)) {
        insideToolBlock = false;
        continue;
      }

      // Skip everything inside tool execution blocks
      if (insideToolBlock) {
        continue;
      }

      // Keep all other non-empty lines, but remove leading ">" to prevent blockquote formatting
      if (trimmed.length > 0) {
        // Remove leading ">" that causes blockquote formatting in GitHub markdown
        const cleanedLine = line.replace(/^>\s*/, '');
        filteredLines.push(cleanedLine);
      }
    }

    return filteredLines.join('\n').trim();
  }

  /**
   * Ensure markdown formatting is preserved for GitHub
   * Fixes spacing and formatting issues that can break markdown rendering
   * @param {string} text - Text with markdown
   * @returns {string} Properly formatted markdown
   */
  ensureMarkdownFormatting(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    // Remove any trailing whitespace from each line that might break markdown
    const lines = text.split('\n');
    const processedLines = lines.map(line => line.trimEnd());

    // Join lines
    let cleaned = processedLines.join('\n');

    // Ensure proper spacing around headers (GitHub requires blank line before headers)
    cleaned = cleaned.replace(/([^\n])\n(#{1,6}\s+)/g, '$1\n\n$2');

    // Ensure proper spacing after headers
    cleaned = cleaned.replace(/(#{1,6}\s+[^\n]+)\n([^\n#])/g, '$1\n\n$2');

    // Ensure proper spacing around horizontal rules
    cleaned = cleaned.replace(/([^\n])\n(---+)\n/g, '$1\n\n$2\n\n');

    // Remove excessive blank lines (more than 2 consecutive)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Ensure content starts and ends cleanly
    return cleaned.trim();
  }

  /**
   * Clean Amazon Q CLI output (removes ANSI codes and tool execution blocks)
   * @param {string} text - Raw Amazon Q CLI output
   * @returns {string} Cleaned output
   */
  cleanAmazonQOutput(text) {
    let cleaned = this.removeAnsiCodes(text);
    cleaned = this.removeToolExecutionBlocks(cleaned);
    cleaned = this.ensureMarkdownFormatting(cleaned);
    return cleaned;
  }

  /**
   * Clean Claude CLI output (currently just trims, but can be extended)
   * @param {string} text - Raw Claude CLI output
   * @returns {string} Cleaned output
   */
  cleanClaudeOutput(text) {
    // Claude CLI output is already clean (JSON parsed)
    // This method is here for consistency and future extensibility
    return text ? text.trim() : text;
  }

  /**
   * Generic clean method that chooses appropriate cleaning based on CLI type
   * @param {string} text - Raw CLI output
   * @param {string} cliType - 'claude' or 'amazonq'
   * @returns {string} Cleaned output
   */
  clean(text, cliType = 'amazonq') {
    if (cliType === 'claude') {
      return this.cleanClaudeOutput(text);
    } else {
      return this.cleanAmazonQOutput(text);
    }
  }
}

module.exports = { OutputCleaner };
