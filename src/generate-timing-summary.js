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
 * Add placeholder timings for missing workflow steps
 * These will show as "N/A" in the summary until proper timing is implemented
 * @param {TimingTracker} tracker - Timing tracker instance
 */
function addMissingStepPlaceholders(tracker) {
  const existingPhases = new Set(tracker.getTimings().map(t => t.phase));

  // Check if investigation step exists (could be "Q CLI Execution" or "CLAUDE CLI Execution")
  const hasInvestigation = Array.from(existingPhases).some(phase =>
    phase.includes('CLI Execution')
  );

  // Define all expected workflow steps in order
  const expectedSteps = [
    { phase: 'Install Node.js', category: 'setup' },
    { phase: 'Install Dependencies', category: 'setup' },
    { phase: 'Prepare action', category: 'setup' },
    { phase: 'Install CLI Tools', category: 'setup' },
    { phase: 'MCP Setup', category: 'setup' },
    { phase: 'Update comment with results', category: 'finalization' },
    { phase: 'Generate Timing Summary', category: 'finalization' }
  ];

  // Add placeholders for missing steps
  for (const step of expectedSteps) {
    if (!existingPhases.has(step.phase)) {
      console.log(`[TIMING] Adding placeholder for missing step: ${step.phase}`);
      tracker.record(step.phase, 0, {
        placeholder: true,
        category: step.category,
        note: 'Timing not yet tracked for this step'
      });
    }
  }

  // Note: "Run AWS APM Investigation" is tracked as "Q CLI Execution" or "CLAUDE CLI Execution"
  // so we don't add a placeholder for it
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

    // Add placeholders for missing workflow steps
    addMissingStepPlaceholders(tracker);

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
