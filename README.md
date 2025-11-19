# Application observability for AWS Action

This action brings Agentic AI capabilities directly into GitHub, enabling service issue investigation with live production context, automated Application Signals enablement, and AI-powered bug fixing with live telemetry data.

This action is powered by the [AWS Application Signals MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server) and [AWS CloudWatch MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-mcp-server), and allows you to **bring-your-own-Bedrock-model** with modern AI agent tools or use your existing AI subscriptions. When you mention `@awsapm` in GitHub issues, it helps you troubleshoot production issues, implement fixes, and enhance observability coverage on demand.

## ✨ Features

With a one-time setup of Application observability for AWS Action workflow for your GitHub repository, developers can:

1. **Troubleshoot Production Issues**: Investigate and fix production problems using live telemetry and SLO data
2. **Instrumentation Assistance**: Automatically instrument your applications directly from GitHub
3. **AI-Powered Analysis**: Leverage modern AI coding agents to analyze performance issues and provide recommendations
4. **Automated Workflows**: Responds to `@awsapm` mentions in issues, working around the clock

## 🚀 Getting Started

### Choose Your AI Agent Tool

This action supports multiple AI agent tools. Choose one based on your needs:

---

### Option 1: Claude Code CLI with Custom Bedrock Model

#### Prerequisites
- **Repository Write Access**: Users must have write access or above to trigger the action
- **AWS IAM Role**: Configure an IAM role with OIDC for GitHub Actions (for AWS Application Signals/CloudWatch access AND Bedrock model access)
- **GitHub Token**: Workflow requires specific permissions (automatically provided via `GITHUB_TOKEN`)

#### Setup Steps

##### Step 1: Set up AWS Credentials

This action relies on the [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials) action to set up AWS authentication in your GitHub Actions Environment. We **highly recommend** using OpenID Connect (OIDC) to authenticate with AWS. OIDC allows your GitHub Actions workflows to access AWS resources using short-lived AWS credentials so you do not have to store long-term credentials in your repository.

To use OIDC authentication, you need to first create an IAM Identity Provider that trusts GitHub's OIDC endpoint. This can be done the AWS Management Console by adding a new Identity Provider with the following details:
* **Provider Type**: OpenID Connect
* **Provider URL**: `https://token.actions.githubusercontent.com`
* **Audience**: `sts.amazonaws.com`

Next, create a new IAM policy with the required permissions for this GitHub Action. See the [Required Permissions](#required-permissions) section below for more details.

**Important**: The IAM role must also have permissions to invoke the Bedrock model. Add Bedrock permissions to your IAM policy:
```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithResponseStream"
  ],
  "Resource": "arn:aws:bedrock:*::foundation-model/*"
}
```

Finally, create an IAM Role via the AWS Management Console with the following trust policy template:

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

In the **Permissions policies** page, add the IAM permissions policy you created.

See the [configure-aws-credentials OIDC Quick Start Guide](https://github.com/aws-actions/configure-aws-credentials/tree/main?tab=readme-ov-file#quick-start-oidc-recommended) for more information about setting up OIDC with AWS.

##### Step 2: Configure Secrets and Add Workflow

Go to your repository → Settings → Secrets and variables → Actions.

Create a new repository secret `AWSAPM_ROLE_ARN` and set it to the IAM role you created in the previous step.
You can also specify your region by setting a repository variable `AWS_REGION`.

Example workflow file (e.g., `.github/workflows/awsapm.yml`):

```yaml
name: Application observability for AWS

on:
  issue_comment:
    types: [created, edited]
  issues:
    types: [opened, assigned, edited]

jobs:
  awsapm-investigation:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@awsapm')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@awsapm') || contains(github.event.issue.title, '@awsapm')))
    runs-on: ubuntu-latest
    permissions:
      contents: write        # To create branches for PRs
      pull-requests: write   # To post comments on PRs
      issues: write          # To post comments on issues
      id-token: write        # required to configure AWS credentials using OIDC
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWSAPM_ROLE_ARN }} # this should be the ARN of the IAM role you created for GitHub Actions
          aws-region: ${{ vars.AWS_REGION || 'us-east-1' }}

      - name: Run Application observability for AWS Investigation
        uses: aws-actions/application-observability-for-aws@v1
        with:
          bot_name: "@awsapm"
          cli_tool: "claude_code"
          bedrock_model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
```

**Note:** You can create separate workflows for different regions or environments by customizing the bot name starting with `@awsapm` (e.g., `@awsapm-prod`, `@awsapm-staging`) and configuring each with environment-specific AWS IAM role credentials and region.

##### Step 3: Start Using the Action

Simply mention `@awsapm` in any issue or pull request comment:

```
Hi @awsapm, can you check why my service is having SLO breaching?

Hi @awsapm, can you enable Application Signals for lambda-audit-service? Post a PR for the required changes.

Hi @awsapm, I want to know how many GenAI tokens have been used by my services?
```

---

### Option 2: Amazon Q Developer CLI

#### Prerequisites
- **Repository Write Access**: Users must have write access or above to trigger the action
- **AWS IAM Role**: Configure an IAM role with OIDC for GitHub Actions (used for both AWS resource access and Q CLI authentication)
- **GitHub Token**: Workflow requires specific permissions (automatically provided via `GITHUB_TOKEN`)

#### Setup Steps

##### Step 1: Set up AWS Credentials

Follow the same AWS OIDC setup as described in [Option 1 - Step 1](#step-1-set-up-aws-credentials) above to configure AWS credentials for accessing Application Signals and CloudWatch data.

##### Step 2: Configure Secrets and Add Workflow

Use the same workflow structure as [Option 1](#step-2-configure-secrets-and-add-workflow), but configure the action step as:

```yaml
- name: Run Application observability for AWS Investigation
  uses: aws-actions/application-observability-for-aws@v1
  with:
    bot_name: "@awsapm"
    cli_tool: "amazon_q_cli"
```

##### Step 3: Start Using the Action

Simply mention `@awsapm` in any issue or pull request comment (same as Option 1).

---

## 🔒 Security

This action prioritizes security with strict access controls, OIDC-based AWS authentication, and built-in protections against prompt injection attacks. Only users with repository write access can trigger the action, and all operations are scoped to the specific repository.

For detailed security information, including:
- Access control and token permissions
- AWS IAM permissions and OIDC setup
- Prompt injection risks and mitigations
- Security best practices

See the [Security Documentation](SECURITY.md).

## ⚙️ Configuration

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `bot_name` | The bot name to respond to in comments | No | `@awsapm` |
| `target_branch` | The branch to merge PRs into | No | Repository default |
| `branch_prefix` | Prefix for created branches | No | `awsapm/` |
| `github_token` | GitHub token for API calls | No | `${{ github.token }}` |
| `custom_prompt` | Custom instructions for the AI agent | No | - |
| `cli_tool` | CLI tool to use for investigation (`amazon_q_cli` or `claude_code`) | Yes | - |
| `cli_tool_oauth_token` | OAuth token for the selected CLI tool (required when cli_tool is claude_code and bedrock_model is not set) | No | - |
| `bedrock_model` | Bedrock model ID to use with Claude Code CLI (e.g., `us.anthropic.claude-sonnet-4-5-20250929-v1:0`). When set, cli_tool_oauth_token is not required. | No | - |
| `enable_cloudwatch_mcp` | Enable CloudWatch MCP server for metrics, alarms, and log insights | No | `true` |

### Selecting Your AI Agent Tool

The `cli_tool` input determines which AI agent tool to use for investigations:

**Available Options:**
- `amazon_q_cli`: Amazon Q Developer CLI - Uses AWS OIDC authentication
- `claude_code`: Claude Code CLI - Requires `bedrock_model`

**Quick Reference:**

```yaml
# Claude Code CLI with Custom Bedrock Model
- uses: aws-actions/application-observability-for-aws@v1
  with:
    cli_tool: "claude_code"
    bedrock_model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

# Amazon Q Developer CLI
- uses: aws-actions/application-observability-for-aws@v1
  with:
    cli_tool: "amazon_q_cli"
```

For complete setup instructions, see [Getting Started](#-getting-started).

### Required Permissions

The action requires:

1. **AWS Permissions**:
The IAM role assumed by GitHub Actions needs to have a permission policy with the following permissions.
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "q:SendMessage",
                "application-signals:ListServices",
                "application-signals:GetService",
                "application-signals:ListServiceOperations",
                "application-signals:ListServiceLevelObjectives",
                "application-signals:GetServiceLevelObjective",
                "application-signals:ListAuditFindings",
                "cloudwatch:DescribeAlarms",
                "cloudwatch:DescribeAlarmHistory",
                "cloudwatch:ListMetrics",
                "cloudwatch:GetMetricData",
                "cloudwatch:GetMetricStatistics",
                "logs:DescribeLogGroups",
                "logs:DescribeQueryDefinitions",
                "logs:ListLogAnomalyDetectors",
                "logs:ListAnomalies",
                "logs:StartQuery",
                "logs:StopQuery",
                "logs:GetQueryResults",
                "logs:FilterLogEvents",
                "xray:GetTraceSummaries",
                "xray:GetTraceSegmentDestination",
                "synthetics:GetCanary",
                "synthetics:GetCanaryRuns",
                "s3:GetObject",
                "s3:ListBucket",
                "iam:GetRole",
                "iam:ListAttachedRolePolicies",
                "iam:GetPolicy",
                "iam:GetPolicyVersion",
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream"
            ],
            "Resource": "*"
        }
    ]
}
```

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

For more information, check out:

- [AWS Application Signals Documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Intro.html) - Learn about Application Signals features and capabilities
- Application observability for AWS Action Public Documentation [link TBA] - Detailed guides and tutorials (coming soon)

## 💰 Cost Considerations

Usage costs vary based on your selected CLI tool:

### Claude Code CLI with Custom Bedrock Model (Option 1)
- **Billed to your AWS account** where IAM role is created
- **Charged per-token** for Bedrock `InvokeModel` API calls based on the specific Claude model used
- **Additional AWS service costs** for CloudWatch, Application Signals API calls via MCPs
- See [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) for model-specific rates
- Set up [AWS Budget Alerts](https://aws.amazon.com/aws-cost-management/aws-budgets/) to monitor spending

### Amazon Q Developer CLI (Option 2)
- **Free tier available** with no cost
- **Usage limits**: Approximately 1,000 requests per AWS account per month
- **Additional AWS service costs** for CloudWatch, Application Signals API calls via MCPs
- Exceeding free tier limits may incur charges - see [Amazon Q Developer pricing](https://aws.amazon.com/q/developer/pricing/) for details

**Recommendation:** Set up cost monitoring and budget alerts for your AWS account to track spending across all services.

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT-0 License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

For issues and questions:
- Create a [GitHub issue](https://github.com/aws-actions/application-observability-for-aws/issues)
- Check the troubleshooting documentation (coming soon)
- Review the action logs in your workflow runs

---
