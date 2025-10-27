const { generateSummary } = require('../src/summary');
const { TimingTracker } = require('../src/utils/timing');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock @actions/core
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  summary: {
    addHeading: jest.fn().mockReturnThis(),
    addTable: jest.fn().mockReturnThis(),
    addRaw: jest.fn().mockReturnThis(),
    write: jest.fn().mockResolvedValue(undefined),
  },
}));

const core = require('@actions/core');

describe('summary', () => {
  let originalEnv;
  let tempDir;
  let outputDir;
  let timingFile;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-test-'));
    outputDir = path.join(tempDir, 'awsapm-output');
    fs.mkdirSync(outputDir, { recursive: true });
    timingFile = path.join(outputDir, 'timing.json');

    // Set up environment
    process.env.RUNNER_TEMP = tempDir;
  });

  afterEach(() => {
    process.env = originalEnv;

    // Cleanup temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('generateSummary', () => {
    test('generates summary with timing data', async () => {
      const summaryFile = path.join(tempDir, 'summary.txt');
      process.env.GITHUB_STEP_SUMMARY = summaryFile;

      const tracker = new TimingTracker();
      tracker.record('Operation 1', 1500);
      tracker.record('Operation 2', 2000);
      tracker.save(timingFile);

      await generateSummary();

      // Should write to summary file
      expect(fs.existsSync(summaryFile)).toBe(true);
    });

    test('loads bash timing data when available', async () => {
      const summaryFile = path.join(tempDir, 'summary.txt');
      process.env.GITHUB_STEP_SUMMARY = summaryFile;

      const tracker = new TimingTracker();
      tracker.record('Node operation', 1000);
      tracker.save(timingFile);

      const bashTimingFile = path.join(outputDir, 'timing-bash.json');
      const bashData = {
        timings: [
          { phase: 'setup', eventType: 'start', timestamp: 1000 },
          { phase: 'setup', eventType: 'end', timestamp: 3000 }
        ]
      };
      fs.writeFileSync(bashTimingFile, JSON.stringify(bashData));

      await generateSummary();

      expect(fs.existsSync(summaryFile)).toBe(true);
    });

    test('handles malformed bash timing data', async () => {
      const tracker = new TimingTracker();
      tracker.record('Operation', 1000);
      tracker.save(timingFile);

      const bashTimingFile = path.join(outputDir, 'timing-bash.json');
      fs.writeFileSync(bashTimingFile, 'invalid json');

      await generateSummary();

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to load bash timings'));
    });

    test('adds placeholders for missing workflow steps', async () => {
      const summaryFile = path.join(tempDir, 'summary.txt');
      process.env.GITHUB_STEP_SUMMARY = summaryFile;

      const tracker = new TimingTracker();
      tracker.record('Q CLI Execution', 5000);
      tracker.save(timingFile);

      await generateSummary();

      expect(fs.existsSync(summaryFile)).toBe(true);
    });

    test('handles missing directory gracefully', async () => {
      process.env.RUNNER_TEMP = '/nonexistent/path';

      await generateSummary();

      // Should not error - just returns early if no timing data
      expect(core.error).not.toHaveBeenCalled();
    });

    test('includes GitHub Job Summary', async () => {
      const summaryFile = path.join(tempDir, 'summary.txt');
      process.env.GITHUB_STEP_SUMMARY = summaryFile;

      const tracker = new TimingTracker();
      tracker.record('Setup', 1000);
      tracker.record('Execution', 5000);
      tracker.record('Cleanup', 500);
      tracker.save(timingFile);

      await generateSummary();

      expect(fs.existsSync(summaryFile)).toBe(true);
      const content = fs.readFileSync(summaryFile, 'utf8');
      expect(content).toContain('Timing Summary');
    });

    test('processes multiple bash timing pairs', async () => {
      const summaryFile = path.join(tempDir, 'summary.txt');
      process.env.GITHUB_STEP_SUMMARY = summaryFile;

      const tracker = new TimingTracker();
      tracker.save(timingFile);

      const bashTimingFile = path.join(outputDir, 'timing-bash.json');
      const bashData = {
        timings: [
          { phase: 'step1', eventType: 'start', timestamp: 1000 },
          { phase: 'step1', eventType: 'end', timestamp: 2000 },
          { phase: 'step2', eventType: 'start', timestamp: 2100 },
          { phase: 'step2', eventType: 'end', timestamp: 3000 }
        ]
      };
      fs.writeFileSync(bashTimingFile, JSON.stringify(bashData));

      await generateSummary();

      expect(fs.existsSync(summaryFile)).toBe(true);
    });
  });

  describe('bash timing parsing', () => {
    test('pairs start and end entries correctly', async () => {
      const summaryFile = path.join(tempDir, 'summary.txt');
      process.env.GITHUB_STEP_SUMMARY = summaryFile;

      const tracker = new TimingTracker();
      tracker.save(timingFile);

      const bashTimingFile = path.join(outputDir, 'timing-bash.json');
      const bashData = {
        timings: [
          { phase: 'checkout', eventType: 'start', timestamp: 1000 },
          { phase: 'checkout', eventType: 'end', timestamp: 3000 },
          { phase: 'build', eventType: 'start', timestamp: 3500 },
          { phase: 'build', eventType: 'end', timestamp: 7500 }
        ]
      };
      fs.writeFileSync(bashTimingFile, JSON.stringify(bashData));

      await generateSummary();

      // Should parse and include both phases
      expect(fs.existsSync(summaryFile)).toBe(true);
    });

    test('ignores orphaned start entries', async () => {
      const tracker = new TimingTracker();
      tracker.save(timingFile);

      const bashTimingFile = path.join(outputDir, 'timing-bash.json');
      const bashData = {
        timings: [
          { phase: 'orphan', eventType: 'start', timestamp: 1000 },
          { phase: 'complete', eventType: 'start', timestamp: 2000 },
          { phase: 'complete', eventType: 'end', timestamp: 3000 }
        ]
      };
      fs.writeFileSync(bashTimingFile, JSON.stringify(bashData));

      await generateSummary();

      // Should handle gracefully
      expect(core.error).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('does not fail workflow when directory missing', async () => {
      process.env.RUNNER_TEMP = '/definitely/nonexistent/path';

      await generateSummary();

      // Should handle gracefully without errors
      expect(core.error).not.toHaveBeenCalled();
    });

    test('handles file system errors', async () => {
      // Create timing file but make it unreadable
      fs.writeFileSync(timingFile, JSON.stringify({ timings: [] }));
      fs.chmodSync(timingFile, 0o000);

      await generateSummary();

      // Should handle gracefully with a warning
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to load timings'));

      // Restore permissions for cleanup
      fs.chmodSync(timingFile, 0o644);
    });
  });
});
