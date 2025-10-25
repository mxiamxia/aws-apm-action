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
   * Drops everything up to and including the last "● Completed in" line
   * This removes all banner, tips, tool executions, and other UI elements
   * @param {string} text - Text containing tool execution blocks and UI elements
   * @returns {string} Cleaned analysis result
   */
  removeToolExecutionBlocks(text) {
    const lines = text.split('\n');

    // Find the last occurrence of "● Completed in" (final tool execution)
    let lastToolCompletionIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().match(/^●\s*Completed in/)) {
        lastToolCompletionIndex = i;
        break;
      }
    }

    // If found, drop everything up to and including that line
    // If not found, keep all lines (no tool executions)
    const startIndex = lastToolCompletionIndex >= 0 ? lastToolCompletionIndex + 1 : 0;
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
