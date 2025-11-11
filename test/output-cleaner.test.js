const { OutputCleaner } = require('../src/utils/output-cleaner');

describe('OutputCleaner', () => {
  let cleaner;

  beforeEach(() => {
    cleaner = new OutputCleaner();
  });

  describe('removeAnsiCodes', () => {
    test('removes basic ANSI color codes', () => {
      const input = '\x1b[31mRed text\x1b[0m Normal text';
      const result = cleaner.removeAnsiCodes(input);
      expect(result).toBe('Red text Normal text');
    });

    test('removes proper ANSI cursor control', () => {
      const input = '\x1b[?25lText with cursor\x1b[?25h';
      const result = cleaner.removeAnsiCodes(input);
      expect(result).toBe('Text with cursor');
    });

    test('removes cursor movement codes', () => {
      const input = '\x1b[2ACursor up\x1b[3BDown';
      const result = cleaner.removeAnsiCodes(input);
      expect(result).toBe('Cursor upDown');
    });

    test('removes clear screen codes', () => {
      const input = '\x1b[2JCleared screen\x1b[K';
      const result = cleaner.removeAnsiCodes(input);
      expect(result).toBe('Cleared screen');
    });

    test('handles plain text without ANSI codes', () => {
      const input = 'Just plain text';
      const result = cleaner.removeAnsiCodes(input);
      expect(result).toBe('Just plain text');
    });

    test('handles empty input', () => {
      expect(cleaner.removeAnsiCodes('')).toBe('');
    });

    test('handles null input', () => {
      expect(cleaner.removeAnsiCodes(null)).toBe(null);
    });

    test('removes replacement characters', () => {
      const input = 'Text with � replacement';
      const result = cleaner.removeAnsiCodes(input);
      expect(result).toBe('Text with  replacement');
    });

    test('removes complex mixed ANSI sequences', () => {
      const input = '\x1b[31m\x1b[1mBold Red\x1b[0m �[?25lHidden\x1b[2J?25lFragment';
      const result = cleaner.removeAnsiCodes(input);
      expect(result).toBe('Bold Red HiddenFragment');
    });
  });

  describe('removeToolExecutionBlocks', () => {
    test('finds custom marker and keeps everything from that line', () => {
      const input = `Banner text
Tool output
● Completed in 1s
🎯 **Application observability for AWS Assistant Result**

## Analysis Result
Here is the analysis`;

      const result = cleaner.removeToolExecutionBlocks(input);
      expect(result).toContain('🎯 **Application observability for AWS Assistant Result**');
      expect(result).toContain('## Analysis Result');
      expect(result).not.toContain('Banner text');
      expect(result).not.toContain('Tool output');
    });

    test('falls back to cursor control sequence when marker not found', () => {
      const input = `Banner
UI noise
�[?25l
## Actual Result
Content here`;

      const result = cleaner.removeToolExecutionBlocks(input);
      expect(result).toContain('## Actual Result');
      expect(result).toContain('Content here');
      expect(result).not.toContain('Banner');
      expect(result).not.toContain('UI noise');
      expect(result).not.toContain('�[?25l');
    });

    test('falls back to completed marker when no cursor control', () => {
      const input = `Tool execution
● Running tool1 with param
● Completed in 1.5s
## Analysis
Result here`;

      const result = cleaner.removeToolExecutionBlocks(input);
      expect(result).toContain('## Analysis');
      expect(result).toContain('Result here');
      expect(result).not.toContain('Tool execution');
      expect(result).not.toContain('● Running');
    });

    test('uses last completed marker when multiple tools executed', () => {
      const input = `● Running tool1
● Completed in 1s
Some content
● Running tool2
● Completed in 2s
Final result`;

      const result = cleaner.removeToolExecutionBlocks(input);
      expect(result).toBe('Final result');
      expect(result).not.toContain('tool1');
      expect(result).not.toContain('Some content');
    });

    test('keeps entire output when no markers found', () => {
      const input = `## Analysis
Just the result
No tool markers`;

      const result = cleaner.removeToolExecutionBlocks(input);
      expect(result).toBe(input.trim());
    });

    test('removes thinking statements (lines starting with >)', () => {
      const input = `🎯 **Application observability for AWS Assistant Result**

> Thinking about the problem
> Analyzing data
## Result
Actual content`;

      const result = cleaner.removeToolExecutionBlocks(input);
      expect(result).toContain('## Result');
      expect(result).toContain('Actual content');
      expect(result).not.toContain('> Thinking');
      expect(result).not.toContain('> Analyzing');
    });

    test('preserves blank lines in output', () => {
      const input = `🎯 **Application observability for AWS Assistant Result**

Line 1

Line 2`;

      const result = cleaner.removeToolExecutionBlocks(input);
      expect(result).toContain('\n\n');
    });
  });

  describe('ensureMarkdownFormatting', () => {
    test('adds spacing before headers', () => {
      const input = 'Text\n## Header';
      const result = cleaner.ensureMarkdownFormatting(input);
      expect(result).toContain('Text\n\n## Header');
    });

    test('adds spacing after headers', () => {
      const input = '## Header\nText';
      const result = cleaner.ensureMarkdownFormatting(input);
      expect(result).toContain('## Header\n\nText');
    });

    test('adds spacing around horizontal rules', () => {
      const input = 'Text\n---\nMore text';
      const result = cleaner.ensureMarkdownFormatting(input);
      expect(result).toContain('Text\n\n---\n\nMore text');
    });

    test('removes excessive blank lines', () => {
      const input = 'Text\n\n\n\n\nMore text';
      const result = cleaner.ensureMarkdownFormatting(input);
      expect(result).toBe('Text\n\nMore text');
    });

    test('trims trailing whitespace from lines', () => {
      const input = 'Line with spaces   \nAnother line  ';
      const result = cleaner.ensureMarkdownFormatting(input);
      expect(result).toBe('Line with spaces\nAnother line');
    });

    test('handles null input', () => {
      const result = cleaner.ensureMarkdownFormatting(null);
      expect(result).toBeNull();
    });

    test('handles non-string input', () => {
      const result = cleaner.ensureMarkdownFormatting(123);
      expect(result).toBe(123);
    });
  });

  describe('cleanAmazonQOutput (integration)', () => {
    test('full pipeline: removes ANSI, tool blocks, and formats markdown', () => {
      const input = `\x1b[31mBanner\x1b[0m
● Running get_file with param
● Completed in 0.5s
�[?25l
🎯 **Application observability for AWS Assistant Result**

## Analysis
Result text\x1b[0m`;

      const result = cleaner.cleanAmazonQOutput(input);
      expect(result).toContain('🎯 **Application observability for AWS Assistant Result**');
      expect(result).toContain('## Analysis');
      expect(result).toContain('Result text');
      expect(result).not.toContain('Banner');
      expect(result).not.toContain('● Running');
      expect(result).not.toContain('\x1b');
      expect(result).not.toContain('�');
    });

    test('handles real Amazon Q 1.19.0 style output', () => {
      const input = `[ASCII art banner]
Did you know?
What's New in Amazon Q CLI
● Running tool1 with params
  { "file": "test.js" }
● Completed in 1.2s
�[?25l
🎯 **Application observability for AWS Assistant Result**

## SLO Breach Analysis

Root cause: Exception in Lambda
Impact: 12% fault rate`;

      const result = cleaner.cleanAmazonQOutput(input);
      expect(result).toContain('🎯 **Application observability for AWS Assistant Result**');
      expect(result).toContain('## SLO Breach Analysis');
      expect(result).toContain('Root cause');
      expect(result).not.toContain('Did you know');
      expect(result).not.toContain('What\'s New');
      expect(result).not.toContain('● Running');
    });

    test('clean method delegates to cleanAmazonQOutput', () => {
      const input = 'Test input';
      const result = cleaner.clean(input);
      expect(result).toBe(cleaner.cleanAmazonQOutput(input));
    });
  });
});
