# Application Observability for AWS Action

A GitHub Action that brings Agentic AI capabilities directly into GitHub, enabling service issue investigation with live production context, automated Application Signals enablement, and AI-powered bug fixing with live telemetry data.

This action is powered by the [AWS Application Signals MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server) and works with Amazon Q Developer CLI. When you mention `@awsapm` in GitHub issues or pull request comments, it helps you troubleshoot production issues, implement fixes, and enhance observability coverage on demand.

## ✨ Features

With a one-time setup of Application Observability for AWS Action workflow for your GitHub repository, developers can:

1. **Troubleshoot Production Issues**: Investigate and fix production problems using live telemetry and SLO data from AWS Application Signals via MCP
2. **Application Observability Enablement Assistance**: Get help enabling Application Signals with integrated Application Signals MCP and domain knowledge as context
3. **AI-Powered Analysis**: Leverage Amazon Q Developer CLI for intelligent code analysis and recommendations
4. **Automated Workflows**: Responds to `@awsapm` mentions in issues and PR comments, working around the clock

## 📋 Prerequisites

- AWS credentials with permissions for [AWS Application Signals MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server#configuration)
- GitHub token with appropriate permissions (automatically provided via `github.token`)
- Repository write access for users triggering the action

## 🚀 Quick Start

### Setup Steps (One-Time)

#### 1. Set up AWS Credentials

This action relies on the [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials) action to set up AWS authentication in your Github Actions Environment. We **highly recommend** using OpenID Connect (OIDC) to authenticate with AWS. OIDC allows your GitHub Actions workflows to access AWS resources using short-lived AWS credentials so you do not have to store long-term credentials in your repository.

To use OIDC authentication, you must configure a trust policy in AWS IAM that allows GitHub Actions to assume an IAM role using this template:

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_ORG>/<GITHUB_REPOSITORY>:ref:refs/heads/<GITHUB_BRANCH>"
        }
      }
    }
  ]
}
```

See the [configure-aws-credentials OIDC Quick Start Guide](https://github.com/aws-actions/configure-aws-credentials/tree/main?tab=readme-ov-file#quick-start-oidc-recommended) for more information about setting up OIDC with AWS.

#### 2. Add Workflow Configuration

Create `.github/workflows/awsapm.yml` in your repository:

```yaml
name: Application Observability

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]

jobs:
  apm-analysis:
    if: contains(github.event.comment.body, '@awsapm') || contains(github.event.issue.body, '@awsapm')
    runs-on: ubuntu-latest
    permissions:
      contents: write        # To create branches for PRs
      pull-requests: write   # To post comments on PRs
      issues: write          # To post comments on issues
      checks: write          # To create check runs with detailed results
      id-token: write        # required to configure AWS credentials using OIDC 
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }} # this should be the ARN of the IAM role created for Github Actions
          aws-region: ${{ env.AWS_REGION }}

      - name: Run AWS APM Agent
        uses: aws-actions/apm-action@v1
```

#### 3. Start Using the Action

Simply mention `@awsapm` in any issue or pull request comment:

```
Hi @awsapm, can you check why my service is having SLO breaching?

Hi @awsapm, can you enable Application Signals for lambda-audit-service? Post a PR for the required changes.

Hi @awsapm, I want to know how many GenAI tokens have been used by my services?
```

## ⚙️ Configuration

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `bot_name` | The bot name to respond to in comments | No | `@awsapm` |
| `target_branch` | The branch to merge PRs into | No | Repository default |
| `branch_prefix` | Prefix for created branches | No | `awsapm/` |
| `github_token` | GitHub token for API calls | No | `${{ github.token }}` |
| `custom_prompt` | Custom instructions for the AI agent | No | - |

### Required Permissions

The action requires:

1. **AWS Permissions**: Same as [AWS Application Signals MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server#configuration)
2. **GitHub Permissions**:
   - `contents: write` - To create branches for PRs
   - `pull-requests: write` - To post comments on PRs
   - `checks: write` - To create check runs with detailed results

### Outputs

| Output | Description |
|--------|-------------|
| `execution_file` | Path to the analysis results file |
| `branch_name` | Branch created for this execution |
| `github_token` | GitHub token used by the action |

## 📖 Documentation

Comprehensive documentation coming soon! This includes:

- Detailed configuration guide
- Authentication setup (GitHub tokens and Apps)
- MCP integration guide
- Troubleshooting common issues
- Architecture overview

## 🏗️ Architecture

This GitHub Action enables a versatile APM AI Agent within your repository that:

1. **Initialization** - Detects `@awsapm` mentions and validates permissions
2. **Context Gathering** - Collects GitHub context (issues, PRs, comments, diffs) and AWS Application Signals data
3. **AI Agent Execution** - Runs Amazon Q Developer CLI (or Claude Code/Codex) integrated with AWS Application Signals MCP
4. **Action & Response** - Posts analysis, creates branches, submits PRs, or provides troubleshooting guidance

### Integration with AWS Application Signals MCP

The action leverages the [AWS Application Signals MCP server](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server) to provide:
- Live telemetry and SLO data from production services
- Service topology and dependency mapping
- Metrics, traces, and logs correlation
- GenAI token usage tracking and cost analysis

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT-0 License - see the [LICENSE](LICENSE) file for details.

## 🔒 Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for information on reporting security issues.

## 📞 Support

For issues and questions:
- Create a [GitHub issue](https://github.com/aws-actions/application-observability-for-aws/issues)
- Check the troubleshooting documentation (coming soon)
- Review the action logs in your workflow runs

---
