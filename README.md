# Application observability for AWS Action

This action provides an end-to-end application observability investigation workflow that connects your source code and live production telemetry data to AI agent. It leverages CloudWatch MCPs and generates custom prompts to provide the context that AI agents need for troubleshooting and applying code fixes.

The action sets up and configures [AWS Application Signals MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server) and [AWS CloudWatch MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-mcp-server) for AI Agent you have setup in in GitHub workflow, enabling AI agents to access your live telemetry data as troubleshooting context. Customers can continue using their bring-your-own-model, API key or Bedrock models for application performance investigations. Simply mention `@awsapm` in GitHub issues to troubleshoot production issues, implement fixes, and enhance observability coverage on demand.

## ✨ Features

With a one-time setup of Application observability for AWS Action workflow for your GitHub repository, developers can:

1. **Troubleshoot Production Issues**: Investigate and fix production problems using live telemetry and SLO data
2. **Instrumentation Assistance**: Automatically instrument your applications directly from GitHub
3. **AI-Powered Analysis**: Leverage modern AI coding agents to analyze performance issues and provide recommendations and fixes

## 🚀 Getting Started
This action configures your AI agent within your GitHub workflow by generating AWS-specific MCP configurations and custom observability prompts. All you need to provide is IAM role to assume and a [Bedrock Model ID](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html) you want to use, or LLM API tokens from your existing subscription. The example below includes a workflow template showing how this action works with [Anthropic's claude-code-base-action](https://github.com/anthropics/claude-code-action/tree/main/base-action) to run investigations.

### Prerequisites
- **Repository Write Access**: Users must have write access or above to trigger the action
- **AWS IAM Role**: Configure an IAM role with OIDC for GitHub Actions (for AWS Application Signals/CloudWatch access AND Bedrock model access)
- **GitHub Token**: Workflow requires specific permissions (automatically provided via `GITHUB_TOKEN`)

### Setup Steps

#### Step 1: Set up AWS Credentials

This action relies on the [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials) action to set up AWS authentication in your GitHub Actions Environment. We recommend using OpenID Connect (OIDC) to authenticate with AWS. OIDC allows your GitHub Actions workflows to access AWS resources using short-lived AWS credentials so you do not have to store long-term credentials in your repository.

To use OIDC authentication, you need to first create an IAM Identity Provider that trusts GitHub's OIDC endpoint. This can be done in the AWS Management Console by adding a new Identity Provider with the following details:
* **Provider Type**: OpenID Connect
* **Provider URL**: `https://token.actions.githubusercontent.com`
* **Audience**: `sts.amazonaws.com`

Next, create a new IAM policy with the required permissions for this GitHub Action. See the [Required Permissions](#required-permissions) section below for more details.

Finally, create an IAM Role via the AWS Management Console with the following trust policy template to allow the authorized GitHub repositories to assume the Role:

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
Modify the following variables in the template

* <AWS_ACCOUNT_ID>
* repo:<GITHUB_ORG>/<GITHUB_REPOSITORY>:ref:refs/heads/<GITHUB_BRANCH>

 In the Permissions policies page, add the IAM permissions policy you created.

In the **Permissions policies** page, add the IAM permissions policy you created.

See the [configure-aws-credentials OIDC Quick Start Guide](https://github.com/aws-actions/configure-aws-credentials/tree/main?tab=readme-ov-file#quick-start-oidc-recommended) for more information about setting up OIDC with AWS.

#### Step 2: Configure Secrets and Add Workflow

Go to your repository → Settings → Secrets and variables → Actions.

Create a new repository secret `AWS_IAM_ROLE_ARN` and set it to the IAM role you created in the previous step.
Optionally, you can also specify your region by setting a repository variable `AWS_REGION`.

Merge the following Application Observability Investigation workflow [template](./template/awsapm.yaml) to your GitHub Repository folder `.github/workflows`.
```yaml
name: Application observability for AWS

on:
  issue_comment:
    types: [created, edited]
  issues:
    types: [opened, assigned, edited]

jobs:
  awsapm-investigation:
    # Only run when @awsapm is mentioned
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
          role-to-assume: ${{ secrets.AWS_IAM_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION || 'us-east-1' }}

      # Step 1: Prepare AWS MCP configuration and investigation prompt
      - name: Prepare Investigation Context
        id: prepare
        uses: aws-actions/application-observability-for-aws@v1
        with:
          bot_name: "@awsapm"
          cli_tool: "claude_code"

      # Step 2: Execute investigation with Claude Code
      - name: Run Claude Investigation
        id: claude
        uses: anthropics/claude-code-action@v1
        with:
          use_bedrock: "true"
          prompt: ${{ steps.prepare.outputs.prompt_content }}
          claude_args: |
            --model us.anthropic.claude-sonnet-4-5-20250929-v1:0
            --mcp-config ${{ steps.prepare.outputs.mcp_config_file }}
            --allowed-tools ${{ steps.prepare.outputs.allowed_tools }}

      # Step 3: Post results back to GitHub issue/PR (reuse the same action)
      - name: Post Investigation Results
        if: always()
        uses: aws-actions/application-observability-for-aws@v1
        with:
          cli_tool: "claude_code"
          comment_id: ${{ steps.prepare.outputs.awsapm_comment_id }}
          output_file: ${{ steps.claude.outputs.execution_file }}
          output_status: ${{ steps.claude.outputs.conclusion }}
```

**Note:**
- The above template should work out-of-box if you have `AWS_IAM_ROLE_ARN` setup for your GitHub Action
- Specify your Bedrock model using `--model` in the `claude_args` parameter
- You can customize the bot name (e.g., `@awsapm-prod`, `@awsapm-staging`) for different environments
- This example uses `claude-code-action@v1` which requires prompt content inline rather than a file path

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
- Access control with only writer and above permissions users
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
| `custom_prompt` | Custom instructions for the AI agent | No | - |
| `cli_tool` | CLI tool to use (`claude_code`) | No | `claude_code` |
| `output_file` | Path to AI agent execution output file | No | - |
| `output_status` | AI agent execution status (`success` or `failure`) | No | - |

### Outputs

| Output | Description |
|--------|-------------|
| `prompt_content` | Investigation prompt content for `claude-code-action` |
| `mcp_config_file` | Path to MCP servers configuration JSON file |
| `allowed_tools` | Comma-separated list of allowed tools |
| `awsapm_comment_id` | GitHub comment ID for tracking the investigation |
| `branch_name` | Branch created for this execution |
| `github_token` | GitHub token used by the action |

### Required Permissions

The action requires:

**AWS IAM Permissions**:
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
                "xray:BatchGetTraces",
                "xray:ListRetrievedTraces",
                "xray:StartTraceRetrieval",
                "servicequotas:GetServiceQuota",
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

## 📖 Documentation

For more information, check out:

- [AWS Application Signals Documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Intro.html) - Learn about Application Signals features and capabilities
- Application observability for AWS Action Public Documentation [link TBA] - Detailed guides and tutorials (coming soon)

## 💰 Cost Considerations

- **Billed to your AWS account** where the IAM role is created, covering CloudWatch API calls via MCP and Bedrock token usage if you are using Bedrock models.
- See [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) for model-specific rates
- **LLM provider costs** apply if you use a model outside of Bedrock, based on the provider you specify.
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
