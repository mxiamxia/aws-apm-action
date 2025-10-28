const { createGeneralPrompt } = require('../src/prompt-builder');

// Mock @actions/core to suppress warnings during tests
jest.mock('@actions/core', () => ({
  warning: jest.fn(),
}));

const mockContext = {
  payload: {
    repository: {
      name: 'test-repo',
      owner: { login: 'test-owner' },
      html_url: 'https://github.com/test-owner/test-repo'
    },
    issue: {
      number: 1,
      pull_request: null
    },
    pull_request: null,
    comment: {
      id: 123,
      body: '@awsapm test',
      user: { login: 'test-user' },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z'
    }
  },
  repo: {
    owner: 'test-owner',
    repo: 'test-repo'
  },
  eventName: 'issue_comment'
};

const mockRepoInfo = {
  name: 'test-repo',
  owner: 'test-owner',
  description: 'Test repository',
  language: 'JavaScript',
  size: 1024,
  fileCount: 50,
  topics: ['test', 'javascript'],
  hasReadme: true
};

// Mock @actions/github
jest.mock('@actions/github', () => ({
  get context() {
    return mockContext;
  }
}));

describe('prompt-builder', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createGeneralPrompt', () => {
    test('includes user input in prompt', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'analyze this issue');
      expect(prompt).toContain('analyze this issue');
    });

    test('includes result marker instruction', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('🎯 **Application observability for AWS Assistant Result**');
      expect(prompt).toContain('CRITICAL!');
      expect(prompt).toContain('first line of your response');
    });

    test('includes AWS observability context', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('Application observability for AWS');
      expect(prompt).toContain('CloudWatch');
    });

    test('includes custom prompt when provided', async () => {
      process.env.CUSTOM_PROMPT = 'Focus on security vulnerabilities';
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'analyze code');
      expect(prompt).toContain('Focus on security vulnerabilities');
    });

    test('works without custom prompt', async () => {
      delete process.env.CUSTOM_PROMPT;
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
    });

    test('includes repository context', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('test-repo');
    });

    test('includes response guidelines', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('SHORT and CONCISE');
      expect(prompt).toContain('bullet points');
    });

    test('includes PR creation guidelines', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('ONLY create pull requests');
      expect(prompt).toContain('fix this');
      expect(prompt).toContain('create a PR');
    });

    test('includes MCP tool capabilities', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('CAPABILITIES');
      expect(prompt).toContain('What You CAN Do');
    });

    test('handles empty user input', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, '');
      expect(prompt).toBeDefined();
      expect(prompt).toContain('🎯 **Application observability for AWS Assistant Result**');
    });

    test('handles multiline user input', async () => {
      const userInput = `Line 1
Line 2
Line 3`;
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, userInput);
      expect(prompt).toContain('Line 1');
      expect(prompt).toContain('Line 2');
      expect(prompt).toContain('Line 3');
    });
  });

  describe('system prompt structure', () => {
    test('has clear sections', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('IMPORTANT CLARIFICATIONS');
      expect(prompt).toContain('RESPONSE FORMAT REQUIREMENTS');
      expect(prompt).toContain('CAPABILITIES');
    });

    test('includes investigation guidelines', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('AWS');
      expect(prompt).toContain('trace');
    });

    test('includes PR workflow steps', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('Step 1:');
      expect(prompt).toContain('Step 2:');
      expect(prompt).toContain('Step 3:');
      expect(prompt).toContain('create_branch');
      expect(prompt).toContain('create_or_update_file');
      expect(prompt).toContain('create_pull_request');
    });

    test('specifies response format', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('Maximum 3-5 main points');
    });
  });

  describe('custom prompt integration', () => {
    test('appends custom prompt to system instructions', async () => {
      process.env.CUSTOM_PROMPT = 'Additional instruction';
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'user query');
      const customPromptIndex = prompt.indexOf('Additional instruction');
      const userQueryIndex = prompt.indexOf('user query');
      expect(customPromptIndex).toBeGreaterThan(0);
      expect(customPromptIndex).toBeLessThan(userQueryIndex);
    });

    test('handles multiline custom prompt', async () => {
      process.env.CUSTOM_PROMPT = `Line 1 of custom
Line 2 of custom`;
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('Line 1 of custom');
      expect(prompt).toContain('Line 2 of custom');
    });

    test('handles empty custom prompt gracefully', async () => {
      process.env.CUSTOM_PROMPT = '';
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toBeDefined();
    });
  });

  describe('prompt consistency', () => {
    test('generates consistent prompt for same input', async () => {
      const prompt1 = await createGeneralPrompt(mockContext, mockRepoInfo, 'test input');
      const prompt2 = await createGeneralPrompt(mockContext, mockRepoInfo, 'test input');
      expect(prompt1).toBe(prompt2);
    });

    test('generates different prompts for different inputs', async () => {
      const prompt1 = await createGeneralPrompt(mockContext, mockRepoInfo, 'input 1');
      const prompt2 = await createGeneralPrompt(mockContext, mockRepoInfo, 'input 2');
      expect(prompt1).not.toBe(prompt2);
    });
  });
});
