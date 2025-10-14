const fs = require('fs');
const path = require('path');

/**
 * Timing utility for tracking execution durations and generating GitHub Actions Job Summary
 */
class TimingTracker {
  constructor() {
    this.timings = [];
    this.startTimes = new Map();
  }

  /**
   * Start timing for a phase
   * @param {string} phase - Phase name (e.g., "Install Q CLI", "MCP Setup")
   */
  start(phase) {
    this.startTimes.set(phase, Date.now());
    console.log(`[TIMING] Starting: ${phase}`);
  }

  /**
   * End timing for a phase and record duration
   * @param {string} phase - Phase name
   * @param {Object} metadata - Additional metadata (e.g., tool name, details)
   */
  end(phase, metadata = {}) {
    const startTime = this.startTimes.get(phase);
    if (!startTime) {
      console.warn(`[TIMING] No start time found for: ${phase}`);
      return;
    }

    const duration = Date.now() - startTime;
    const timing = {
      phase,
      duration,
      durationFormatted: this.formatDuration(duration),
      timestamp: new Date().toISOString(),
      ...metadata
    };

    this.timings.push(timing);
    this.startTimes.delete(phase);

    console.log(`[TIMING] Completed: ${phase} (${timing.durationFormatted})`);
  }

  /**
   * Record a timing without start/end tracking (for already-known durations)
   * @param {string} phase - Phase name
   * @param {number} duration - Duration in milliseconds
   * @param {Object} metadata - Additional metadata
   */
  record(phase, duration, metadata = {}) {
    const timing = {
      phase,
      duration,
      durationFormatted: this.formatDuration(duration),
      timestamp: new Date().toISOString(),
      ...metadata
    };

    this.timings.push(timing);
    console.log(`[TIMING] Recorded: ${phase} (${timing.durationFormatted})`);
  }

  /**
   * Format duration in human-readable format with decimal precision
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration (e.g., "2m 34.5s", "2.76s", "123ms", "N/A")
   */
  formatDuration(ms) {
    // Special case: 0ms means timing not available
    if (ms === 0) {
      return 'N/A';
    }

    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }

    const totalSeconds = ms / 1000;

    // For times over 1 minute, show minutes and seconds with 1 decimal
    if (totalSeconds >= 60) {
      const minutes = Math.floor(totalSeconds / 60);
      const remainingSeconds = totalSeconds % 60;

      if (remainingSeconds > 0) {
        // Show 1 decimal place for seconds
        return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
      } else {
        return `${minutes}m`;
      }
    }

    // For times under 1 minute, show seconds with 1 decimal place
    return `${totalSeconds.toFixed(1)}s`;
  }

  /**
   * Get all timings
   * @returns {Array} Array of timing objects
   */
  getTimings() {
    return this.timings;
  }

  /**
   * Get total duration
   * Excludes tool call timings to avoid double-counting (they're already included in CLI Execution time)
   * Also excludes placeholder timings for steps not yet tracked
   * @returns {number} Total duration in milliseconds
   */
  getTotalDuration() {
    return this.timings
      .filter(t => !t.toolName && !t.placeholder)  // Exclude tool calls and placeholders from total
      .reduce((sum, t) => sum + t.duration, 0);
  }

  /**
   * Save timings to file (for persistence across steps)
   * @param {string} filePath - Path to save timings
   */
  save(filePath) {
    const data = {
      timings: this.timings,
      totalDuration: this.getTotalDuration(),
      savedAt: new Date().toISOString()
    };

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`[TIMING] Saved timings to: ${filePath}`);
  }

  /**
   * Load timings from file
   * @param {string} filePath - Path to load timings from
   * @returns {TimingTracker} New TimingTracker instance with loaded data
   */
  static load(filePath) {
    const tracker = new TimingTracker();

    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        tracker.timings = data.timings || [];
        console.log(`[TIMING] Loaded ${tracker.timings.length} timings from: ${filePath}`);
      } catch (error) {
        console.warn(`[TIMING] Failed to load timings: ${error.message}`);
      }
    }

    return tracker;
  }

  /**
   * Generate GitHub Actions Job Summary markdown
   * @returns {string} Markdown table for job summary
   */
  generateJobSummary() {
    if (this.timings.length === 0) {
      return '## ⏱️ Timing Summary\n\nNo timing data available.';
    }

    // Group timings by category
    const categories = {
      'Setup': [],
      'Investigation': [],
      'Tool Calls': [],
      'Finalization': []
    };

    for (const timing of this.timings) {
      if (timing.phase.includes('Checkout') || timing.phase.includes('Install') || timing.phase.includes('MCP Setup')) {
        categories['Setup'].push(timing);
      } else if (timing.phase.includes('Investigation') || timing.phase.includes('Execution')) {
        categories['Investigation'].push(timing);
      } else if (timing.phase.includes('Tool:') || timing.toolName) {
        categories['Tool Calls'].push(timing);
      } else {
        categories['Finalization'].push(timing);
      }
    }

    let markdown = '## ⏱️ Timing Summary\n\n';
    markdown += `**Total Duration:** ${this.formatDuration(this.getTotalDuration())}\n\n`;
    markdown += '_Note: Tool call timings are shown for informational purposes and are already included in CLI Execution time. Steps showing N/A are not yet tracked._\n\n';

    // Create table
    markdown += '| Phase | Duration |\n';
    markdown += '|-------|----------|\n';

    for (const [category, timings] of Object.entries(categories)) {
      if (timings.length === 0) continue;

      // Indent "Tool Calls" category to show it's nested under Investigation
      const categoryIndent = category === 'Tool Calls' ? '&nbsp;&nbsp;' : '';
      markdown += `| ${categoryIndent}**${category}** | |\n`;

      for (const timing of timings) {
        const indent = timing.toolName ? '&nbsp;&nbsp;&nbsp;&nbsp;↳ ' : '';
        const displayName = timing.toolName ? `Tool: ${timing.toolName}` : timing.phase;
        markdown += `| ${indent}${displayName} | ${timing.durationFormatted} |\n`;
      }
    }

    return markdown;
  }

  /**
   * Write job summary to GitHub Actions
   * Appends to $GITHUB_STEP_SUMMARY
   */
  writeGitHubJobSummary() {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;

    if (!summaryFile) {
      console.warn('[TIMING] GITHUB_STEP_SUMMARY not set, skipping job summary');
      return;
    }

    const markdown = this.generateJobSummary();

    try {
      fs.appendFileSync(summaryFile, '\n' + markdown + '\n');
      console.log('[TIMING] Job summary written to GitHub Actions');
    } catch (error) {
      console.error(`[TIMING] Failed to write job summary: ${error.message}`);
    }
  }
}

module.exports = { TimingTracker };
