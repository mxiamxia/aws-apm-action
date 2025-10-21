# AWS APM Action

A GitHub Action that provides automated Application Performance Monitoring (APM) analysis using Amazon Q Developer CLI. When users mention `@awsapm` in GitHub issues or pull request comments, this action automatically analyzes the repository and provides APM-focused insights and recommendations.

## Features

- **Automated Trigger**: Responds to `@awsapm` mentions in issues and PR comments
- **Amazon Q Developer CLI Integration**: Uses Amazon Q Developer CLI for code analysis
- **Performance Insights**: Provides specific recommendations for AWS services and monitoring tools
- **Sticky Comments**: Updates the same comment with results (configurable)
- **CloudWatch MCP Integration**: Optional CloudWatch metrics, logs, and alarms access

## Setup

### 1. Repository Secrets

Add the following secrets to your GitHub repository:

```
AWS_ACCESS_KEY_ID         # Required: AWS credentials for Amazon Q Developer CLI
AWS_SECRET_ACCESS_KEY     # Required: AWS credentials for Amazon Q Developer CLI
```

### 2. Repository Variables (Optional)

```
AWS_REGION                # Default: us-east-1
```

### 3. Add the Workflow

Create `.github/workflows/awsapm.yml` in your repository:

```yaml
name: AWS APM Analysis

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  awsapm-analysis:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@awsapm')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@awsapm')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@awsapm')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@awsapm') || contains(github.event.issue.title, '@awsapm')))
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
      id-token: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run AWS APM Analysis
        id: awsapm
        uses: ./
        with:
          aws_access_key_id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws_secret_access_key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws_region: ${{ vars.AWS_REGION || 'us-east-1' }}
          trigger_phrase: "@awsapm"
          use_sticky_comment: "true"
          prompt: |
            You are an AWS APM expert assistant.
            Please analyze this repository and provide insights on:
            1. Performance monitoring opportunities
            2. APM best practices recommendations
            3. AWS services that could improve observability
            4. Specific code patterns that may impact performance
```

## Usage

### Basic Usage

Simply mention `@awsapm` in any issue or pull request comment:

```
@awsapm Can you analyze this repository for performance monitoring opportunities?
```

### Custom Prompts

You can provide specific requests:

```
@awsapm Please review the API endpoints in this PR and suggest CloudWatch metrics we should track.
```

```
@awsapm What AWS services would help us monitor this microservice architecture?
```

### Analysis Types

The action provides insights on:

- **Performance Monitoring**: CloudWatch, X-Ray, and other AWS monitoring services
- **Error Tracking**: Error detection and alerting strategies
- **Distributed Tracing**: Recommendations for tracing in microservices
- **Metrics and Logging**: Key performance indicators and log aggregation
- **Cost Optimization**: Performance improvements that can reduce costs
- **Security Monitoring**: Performance-related security recommendations

## Configuration Options

### Inputs

| Input | Description | Default | Required |
|-------|-------------|---------|----------|
| `trigger_phrase` | Phrase that triggers the action | `@awsapm` | No |
| `aws_access_key_id` | AWS Access Key for Q Developer CLI | - | Yes |
| `aws_secret_access_key` | AWS Secret Key for Q Developer CLI | - | Yes |
| `aws_region` | AWS Region for Q Developer CLI | `us-east-1` | No |
| `enable_cloudwatch_mcp` | Enable CloudWatch MCP tools | `false` | No |
| `github_token` | GitHub token with repo permissions | `${{ github.token }}` | No |
| `use_sticky_comment` | Update the same comment with results | `false` | No |
| `branch_prefix` | Prefix for created branches | `awsapm/` | No |
| `prompt` | Custom instructions for analysis | - | No |

### Outputs

| Output | Description |
|--------|-------------|
| `execution_file` | Path to the analysis results file |
| `branch_name` | Branch created for this execution |
| `github_token` | GitHub token used by the action |

## Examples

### Repository Analysis

When you mention `@awsapm` in an issue:

```
@awsapm Please analyze our Node.js application for APM best practices.
```

**Expected Response:**
- Performance monitoring recommendations
- Suggested AWS services (CloudWatch, X-Ray, etc.)
- Code patterns that may impact performance
- Specific metrics to track

### Pull Request Review

In a PR comment:

```
@awsapm Review the database changes in this PR and suggest monitoring strategies.
```

**Expected Response:**
- Database performance monitoring recommendations
- CloudWatch metrics for database operations
- Alerting strategies for database issues
- Performance optimization suggestions

## Architecture

The action follows this workflow:

1. **Trigger Detection**: Monitors for `@awsapm` mentions in issues/PRs
2. **Analysis Preparation**: Sets up environment and extracts context
3. **Amazon Q CLI Execution**: Runs code analysis using Amazon Q Developer CLI with MCP tools
4. **Response Posting**: Updates GitHub comments with actionable insights

## Development

### Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables
4. Test individual scripts:
   ```bash
   node src/prepare.js
   node src/run-analysis.js
   node src/update-comment.js
   ```

### File Structure

```
aws-apm-action/
├── action.yml              # GitHub Action definition
├── package.json           # Node.js dependencies
├── src/
│   ├── prepare.js          # Trigger detection and setup
│   ├── run-investigation.js # Amazon Q CLI integration with MCP
│   ├── update-comment.js   # GitHub comment updates
│   ├── executors/          # CLI executor classes
│   ├── config/             # MCP configuration
│   └── utils/              # Utilities (timing, output cleaning)
├── .github/
│   └── workflows/
│       └── awsapm.yml      # Example workflow
└── README.md               # This file
```

## Limitations

- Requires AWS credentials for Amazon Q Developer CLI
- GitHub token needs appropriate permissions for commenting
- Analysis quality depends on repository structure and available context
- Large repositories may take longer to analyze

## Troubleshooting

### Common Issues

1. **Action doesn't trigger**: Check that the workflow file is in `.github/workflows/` and the trigger phrase matches
2. **Permission errors**: Ensure the workflow has `pull-requests: write` and `issues: write` permissions
3. **AWS CLI errors**: Check that AWS credentials are properly configured for Amazon Q CLI
4. **MCP errors**: Verify CloudWatch MCP is enabled if using CloudWatch features

### Debug Information

Check the GitHub Actions logs for detailed error messages and execution steps.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
- Create a GitHub issue
- Check the troubleshooting section
- Review the action logs in your workflow runs# aws-apm-action
