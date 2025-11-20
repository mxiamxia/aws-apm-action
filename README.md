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

This action uses [Anthropic's official claude-code-base-action](https://github.com/anthropics/claude-code-action) for executing investigations. This action prepares AWS-specific MCP configurations and prompts, allowing you to **bring your own Bedrock model** - use any Claude model available in Amazon Bedrock with your AWS account.

### Prerequisites
- **Repository Write Access**: Users must have write access or above to trigger the action
- **AWS IAM Role**: Configure an IAM role with OIDC for GitHub Actions (for AWS Application Signals/CloudWatch access AND Bedrock model access)
- **GitHub Token**: Workflow requires specific permissions (automatically provided via `GITHUB_TOKEN`)

### Setup Steps

#### Step 1: Set up AWS Credentials

This action relies on the [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials) action to set up AWS authentication in your GitHub Actions Environment. We **highly recommend** using OpenID Connect (OIDC) to authenticate with AWS. OIDC allows your GitHub Actions workflows to access AWS resources using short-lived AWS credentials so you do not have to store long-term credentials in your repository.

To use OIDC authentication, you need to first create an IAM Identity Provider that trusts GitHub's OIDC endpoint. This can be done in the AWS Management Console by adding a new Identity Provider with the following details:
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

```json
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

#### Step 2: Configure Secrets and Add Workflow

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
      id-token: write        # Required for AWS OIDC authentication
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWSAPM_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION || 'us-east-1' }}

      # Step 1: Prepare AWS MCP config and investigation prompt
      - name: Prepare Investigation Context
        id: prepare
        uses: aws-actions/application-observability-for-aws@v2
        with:
          bot_name: "@awsapm"
          cli_tool: "claude_code"

      # Step 2: Execute investigation with Claude Code
      - name: Run Claude Investigation
        id: claude
        uses: anthropics/claude-code-base-action@beta
        with:
          prompt_file: ${{ steps.prepare.outputs.prompt_file }}
          use_bedrock: "true"
          model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
          mcp_config: ${{ steps.prepare.outputs.mcp_config_file }}
          allowed_tools: ${{ steps.prepare.outputs.allowed_tools }}

      # Step 3: Post results back to GitHub issue/PR
      - name: Post Investigation Results
        if: always()
        uses: aws-actions/application-observability-for-aws@v2
        with:
          bot_name: "@awsapm"
          cli_tool: "claude_code"
          comment_id: ${{ steps.prepare.outputs.awsapm_comment_id }}
          output_file: ${{ steps.claude.outputs.execution_file }}
          output_status: ${{ steps.claude.outputs.conclusion }}
```

**Note:**
- This is a **three-step workflow**: prepare context, execute investigation, post results
- **Step 1 & 3 use the same action** - the action detects whether to prepare or post based on inputs
- Specify your Bedrock model using the `model` input in step 2
- You can customize the bot name (e.g., `@awsapm-prod`, `@awsapm-staging`) for different environments

#### Step 3: Start Using the Action

Simply mention `@awsapm` in any issue or pull request comment:

```
Hi @awsapm, can you check why my service is having SLO breaching?

Hi @awsapm, can you enable Application Signals for lambda-audit-service? Post a PR for the required changes.

Hi @awsapm, I want to know how many GenAI tokens have been used by my services?
```

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
| `cli_tool` | CLI tool to use (`claude_code`) | No | `claude_code` |
| `comment_id` | GitHub comment ID (for posting results in step 3) | No | - |
| `output_file` | Path to AI agent execution output file (for posting results in step 3) | No | - |
| `output_status` | AI agent execution status (`success` or `failure`) | No | - |
| `enable_cloudwatch_mcp` | Enable CloudWatch MCP server | No | `true` |

### Outputs

| Output | Description |
|--------|-------------|
| `prompt_file` | Path to generated prompt file for `claude-code-base-action` |
| `mcp_config_file` | Path to MCP servers configuration JSON file |
| `allowed_tools` | Comma-separated list of allowed tools |
| `awsapm_comment_id` | GitHub comment ID for tracking the investigation |
| `branch_name` | The branch created for this execution |
| `github_token` | The GitHub token used by the action |

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

## 📖 Documentation

For more information, check out:

- [AWS Application Signals Documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Intro.html) - Learn about Application Signals features and capabilities
- Application observability for AWS Action Public Documentation [link TBA] - Detailed guides and tutorials (coming soon)

## 💰 Cost Considerations

- **Billed to your AWS account** where IAM role is created
- **Charged per-token** for Bedrock `InvokeModel` API calls based on the specific Claude model used
- **Additional AWS service costs** for CloudWatch, Application Signals API calls via MCPs
- See [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) for model-specific rates
- **Recommendation:** Set up [AWS Budget Alerts](https://aws.amazon.com/aws-cost-management/aws-budgets/) to monitor spending

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
