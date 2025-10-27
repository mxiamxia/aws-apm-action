const { PromptBuilder } = require('../src/prompt-builder');

// Mock @actions/github
jest.mock('@actions/github', () => ({
  context: {
    payload: {
      repository: {
        name: 'test-repo',
        owner: { login: 'test-owner' }
      },
      issue: null,
      pull_request: null
    },
    repo: {
      owner: 'test-owner',
      repo: 'test-repo'
    },
    eventName: 'issue_comment'
  }
}));

describe('PromptBuilder', () => {
  let builder;
  let originalEnv;

  beforeEach(() => {
    builder = new PromptBuilder();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('buildPrompt', () => {
    test('includes user input in prompt', () => {
      const prompt = builder.buildPrompt('analyze this issue');

      expect(prompt).toContain('analyze this issue');
    });

    test('includes result marker instruction', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('🎯 **Application observability for AWS Assistant Result**');
      expect(prompt).toContain('CRITICAL!');
      expect(prompt).toContain('first line of your response');
    });

    test('includes AWS observability context', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('Application observability for AWS');
      expect(prompt).toContain('CloudWatch');
    });

    test('includes custom prompt when provided', () => {
      process.env.CUSTOM_PROMPT = 'Focus on security vulnerabilities';

      const prompt = builder.buildPrompt('analyze code');

      expect(prompt).toContain('Focus on security vulnerabilities');
    });

    test('works without custom prompt', () => {
      delete process.env.CUSTOM_PROMPT;

      const prompt = builder.buildPrompt('test');

      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
    });

    test('includes repository context', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('test-repo');
    });

    test('includes response guidelines', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('SHORT and CONCISE');
      expect(prompt).toContain('bullet points');
    });

    test('includes PR creation guidelines', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('ONLY create pull requests');
      expect(prompt).toContain('fix this');
      expect(prompt).toContain('create a PR');
    });

    test('includes MCP tool capabilities', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('CAPABILITIES');
      expect(prompt).toContain('What You CAN Do');
    });

    test('handles empty user input', () => {
      const prompt = builder.buildPrompt('');

      expect(prompt).toBeDefined();
      expect(prompt).toContain('🎯 **Application observability for AWS Assistant Result**');
    });

    test('handles multiline user input', () => {
      const userInput = `Line 1
Line 2
Line 3`;

      const prompt = builder.buildPrompt(userInput);

      expect(prompt).toContain('Line 1');
      expect(prompt).toContain('Line 2');
      expect(prompt).toContain('Line 3');
    });

    test('sanitizes special characters in user input', () => {
      const userInput = 'Test with "quotes" and \'apostrophes\'';

      const prompt = builder.buildPrompt(userInput);

      expect(prompt).toContain(userInput);
    });
  });

  describe('system prompt structure', () => {
    test('has clear sections', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('ROLE');
      expect(prompt).toContain('GUIDELINES');
      expect(prompt).toContain('CAPABILITIES');
    });

    test('includes investigation guidelines', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('CloudWatch Application Signals');
      expect(prompt).toContain('SLO');
    });

    test('includes PR workflow steps', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('Step 1:');
      expect(prompt).toContain('Step 2:');
      expect(prompt).toContain('Step 3:');
      expect(prompt).toContain('create_branch');
      expect(prompt).toContain('create_or_update_file');
      expect(prompt).toContain('create_pull_request');
    });

    test('specifies response format', () => {
      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('Maximum 3-5 main points');
    });
  });

  describe('custom prompt integration', () => {
    test('appends custom prompt to system instructions', () => {
      process.env.CUSTOM_PROMPT = 'Additional instruction';

      const prompt = builder.buildPrompt('user query');

      const customPromptIndex = prompt.indexOf('Additional instruction');
      const userQueryIndex = prompt.indexOf('user query');

      expect(customPromptIndex).toBeGreaterThan(0);
      expect(customPromptIndex).toBeLessThan(userQueryIndex);
    });

    test('handles multiline custom prompt', () => {
      process.env.CUSTOM_PROMPT = `Line 1 of custom
Line 2 of custom`;

      const prompt = builder.buildPrompt('test');

      expect(prompt).toContain('Line 1 of custom');
      expect(prompt).toContain('Line 2 of custom');
    });

    test('handles empty custom prompt gracefully', () => {
      process.env.CUSTOM_PROMPT = '';

      const prompt = builder.buildPrompt('test');

      expect(prompt).toBeDefined();
    });
  });

  describe('prompt consistency', () => {
    test('generates consistent prompt for same input', () => {
      const prompt1 = builder.buildPrompt('test input');
      const prompt2 = builder.buildPrompt('test input');

      expect(prompt1).toBe(prompt2);
    });

    test('generates different prompts for different inputs', () => {
      const prompt1 = builder.buildPrompt('input 1');
      const prompt2 = builder.buildPrompt('input 2');

      expect(prompt1).not.toBe(prompt2);
    });
  });
});
