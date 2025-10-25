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
   * Remove tool execution blocks and UI noise from CLI output
   * Looks for the result marker "🎯 **Application observability for AWS Investigation Complete**"
   * and keeps everything from that line onward
   * Falls back to "● Completed in" marker if result marker not found
   * @param {string} text - Text containing tool execution blocks and UI elements
   * @returns {string} Cleaned analysis result
   */
  removeToolExecutionBlocks(text) {
    const core = require('@actions/core');
    const lines = text.split('\n');
    let startIndex = 0;
    let filterMethod = 'none';

    // First, try to find the result marker (most reliable)
    const resultMarker = '🎯 **Application observability for AWS Investigation Complete**';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === resultMarker) {
        startIndex = i;
        filterMethod = 'result_marker';
        break;
      }
    }

    // Fallback: if result marker not found, use the last "● Completed in" line
    if (startIndex === 0) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().match(/^●\s*Completed in/)) {
          startIndex = i + 1; // Start from line after completion
          filterMethod = 'tool_completion';
          break;
        }
      }
    }

    core.debug(`Output filtering method: ${filterMethod}, starting from line ${startIndex} of ${lines.length}`);

    const filteredLines = lines.slice(startIndex);

    // Still remove thinking statements (lines starting with ">")
    const finalLines = filteredLines.filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith('>');
    });

    return finalLines.join('\n').trim();
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
   * Generic clean method - uses Amazon Q output cleaning
   * @param {string} text - Raw CLI output
   * @returns {string} Cleaned output
   */
  clean(text) {
    return this.cleanAmazonQOutput(text);
  }
}

module.exports = { OutputCleaner };
