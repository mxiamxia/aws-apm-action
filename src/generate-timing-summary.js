#!/usr/bin/env node

const { TimingTracker } = require('./utils/timing');
const fs = require('fs');
const path = require('path');

/**
 * Parse bash timing entries (start/end pairs) into durations
 * @param {Array} bashTimings - Array of {phase, eventType, timestamp} objects
 * @returns {Array} Array of timing objects with durations
 */
function parseBashTimings(bashTimings) {
  const startTimes = new Map();
  const parsedTimings = [];

  for (const entry of bashTimings) {
    if (entry.eventType === 'start') {
      startTimes.set(entry.phase, entry.timestamp);
    } else if (entry.eventType === 'end') {
      const startTime = startTimes.get(entry.phase);
      if (startTime) {
        const duration = entry.timestamp - startTime;
        parsedTimings.push({
          phase: entry.phase,
          duration: duration,
          timestamp: entry.timestampISO || new Date(entry.timestamp).toISOString()
        });
        startTimes.delete(entry.phase);
      }
    }
  }

  return parsedTimings;
}

/**
 * Generate timing summary for GitHub Actions Job Summary
 * Loads timing data from both Node.js and bash sources and writes to GITHUB_STEP_SUMMARY
 */
async function generateSummary() {
  try {
    console.log('Generating timing summary...');

    const outputDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-output');
    const timingFile = path.join(outputDir, 'timing.json');
    const bashTimingFile = path.join(outputDir, 'timing-bash.json');

    // Load Node.js timing data
    const tracker = TimingTracker.load(timingFile);

    // Load and parse bash timing data
    if (fs.existsSync(bashTimingFile)) {
      try {
        const bashData = JSON.parse(fs.readFileSync(bashTimingFile, 'utf8'));
        const bashTimings = parseBashTimings(bashData.timings || []);

        console.log(`[TIMING] Loaded ${bashTimings.length} bash-recorded timings`);

        // Add bash timings to tracker
        for (const timing of bashTimings) {
          tracker.record(timing.phase, timing.duration, { source: 'bash' });
        }
      } catch (error) {
        console.warn(`[TIMING] Failed to load bash timings: ${error.message}`);
      }
    }

    if (tracker.getTimings().length === 0) {
      console.log('No timing data available');
      return;
    }

    // Write to GitHub Actions Job Summary
    tracker.writeGitHubJobSummary();

    console.log('Timing summary generated successfully');
  } catch (error) {
    console.error(`Failed to generate timing summary: ${error.message}`);
    // Don't fail the workflow if summary generation fails
  }
}

if (require.main === module) {
  generateSummary();
}

module.exports = { generateSummary };
