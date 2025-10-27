const { TimingTracker } = require('../src/utils/timing');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock @actions/core
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
  summary: {
    addRaw: jest.fn().mockReturnThis(),
    write: jest.fn().mockResolvedValue(undefined),
  }
}));

const core = require('@actions/core');

describe('TimingTracker', () => {
  let tracker;
  let tempDir;

  beforeEach(() => {
    tracker = new TimingTracker();
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('start and end', () => {
    test('records timing with start/end', (done) => {
      tracker.start('Task1');
      setTimeout(() => {
        tracker.end('Task1');
        const timings = tracker.getTimings();
        expect(timings).toHaveLength(1);
        expect(timings[0].phase).toBe('Task1');
        expect(timings[0].duration).toBeGreaterThan(0);
        done();
      }, 50);
    });

    test('handles multiple tasks', (done) => {
      tracker.start('Task1');
      tracker.start('Task2');
      setTimeout(() => {
        tracker.end('Task1');
        tracker.end('Task2');
        expect(tracker.getTimings()).toHaveLength(2);
        done();
      }, 50);
    });

    test('stores metadata', (done) => {
      tracker.start('Task1');
      setTimeout(() => {
        tracker.end('Task1', { result: 'success' });
        const timings = tracker.getTimings();
        expect(timings[0].result).toBe('success');
        done();
      }, 50);
    });
  });

  describe('record', () => {
    test('records direct timing', () => {
      tracker.record('Direct', 1500);
      const timings = tracker.getTimings();
      expect(timings).toHaveLength(1);
      expect(timings[0].phase).toBe('Direct');
      expect(timings[0].duration).toBe(1500);
    });

    test('records timing with metadata', () => {
      tracker.record('Task', 1000, { category: 'setup' });
      const timings = tracker.getTimings();
      expect(timings[0].category).toBe('setup');
    });

    test('formats duration correctly', () => {
      tracker.record('Task', 1500);
      const timings = tracker.getTimings();
      expect(timings[0].durationFormatted).toBe('1.5s');
    });

    test('formats milliseconds correctly', () => {
      tracker.record('Quick', 123);
      const timings = tracker.getTimings();
      expect(timings[0].durationFormatted).toBe('123ms');
    });
  });

  describe('save and load', () => {
    test('saves timing data to file', () => {
      tracker.record('Task1', 1000);
      tracker.record('Task2', 2000);

      const file = path.join(tempDir, 'timings.json');
      tracker.save(file);

      expect(fs.existsSync(file)).toBe(true);
      const content = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(content.timings).toHaveLength(2);
    });

    test('loads timing data from file', () => {
      tracker.record('Task1', 1000);
      const file = path.join(tempDir, 'timings.json');
      tracker.save(file);

      const loaded = TimingTracker.load(file);
      expect(loaded.getTimings()).toHaveLength(1);
      expect(loaded.getTimings()[0].phase).toBe('Task1');
    });

    test('returns new tracker if file does not exist', () => {
      const loaded = TimingTracker.load('/nonexistent/file.json');
      expect(loaded.getTimings()).toHaveLength(0);
    });

    test('handles corrupted file gracefully', () => {
      const file = path.join(tempDir, 'bad.json');
      fs.writeFileSync(file, 'invalid json{');

      const loaded = TimingTracker.load(file);
      expect(loaded.getTimings()).toHaveLength(0);
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to load timings'));
    });
  });

  describe('getTimings', () => {
    test('returns empty array initially', () => {
      expect(tracker.getTimings()).toEqual([]);
    });

    test('returns all recorded timings', () => {
      tracker.record('Task1', 100);
      tracker.record('Task2', 200);

      const timings = tracker.getTimings();
      expect(timings).toHaveLength(2);
    });
  });

  describe('writeGitHubJobSummary', () => {
    test('writes summary to file when GITHUB_STEP_SUMMARY set', () => {
      const fs = require('fs');
      const summaryFile = path.join(tempDir, 'summary.txt');
      process.env.GITHUB_STEP_SUMMARY = summaryFile;

      tracker.record('Task1', 1500);
      tracker.record('Task2', 2000);

      tracker.writeGitHubJobSummary();

      expect(fs.existsSync(summaryFile)).toBe(true);
      const content = fs.readFileSync(summaryFile, 'utf8');
      expect(content).toContain('Timing Summary');
    });
  });

  describe('getTotalDuration', () => {
    test('returns zero for no timings', () => {
      expect(tracker.getTotalDuration()).toBe(0);
    });

    test('sums all durations', () => {
      tracker.record('Task1', 1000);
      tracker.record('Task2', 2000);
      tracker.record('Task3', 500);

      expect(tracker.getTotalDuration()).toBe(3500);
    });

    test('excludes tool timings from total', () => {
      tracker.record('Setup', 1000);
      tracker.record('Some Tool', 500, { toolName: 'some_tool' });
      tracker.record('Cleanup', 1000);

      // Tool timings should be excluded
      expect(tracker.getTotalDuration()).toBe(2000);
    });
  });

  describe('formatDuration', () => {
    test('formats milliseconds', () => {
      expect(tracker.formatDuration(500)).toBe('500ms');
    });

    test('formats minutes and seconds', () => {
      expect(tracker.formatDuration(125000)).toBe('2m 5.0s');
      expect(tracker.formatDuration(65500)).toBe('1m 5.5s');
    });

    test('handles zero as N/A', () => {
      expect(tracker.formatDuration(0)).toBe('N/A');
    });
  });
});
