#!/usr/bin/env node

const { TimingTracker } = require('./utils/timing');
const path = require('path');

/**
 * Generate timing summary for GitHub Actions Job Summary
 * Loads timing data and writes to GITHUB_STEP_SUMMARY
 */
async function generateSummary() {
  try {
    console.log('Generating timing summary...');

    // Load timing data
    const outputDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-output');
    const timingFile = path.join(outputDir, 'timing.json');

    const tracker = TimingTracker.load(timingFile);

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
