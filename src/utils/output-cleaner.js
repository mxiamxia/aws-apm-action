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
   * Clean Amazon Q CLI output (removes ANSI codes and tool execution blocks)
   * @param {string} text - Raw Amazon Q CLI output
   * @returns {string} Cleaned output
   */
  cleanAmazonQOutput(text) {
    let cleaned = this.removeAnsiCodes(text);
    cleaned = this.removeToolExecutionBlocks(cleaned);
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
