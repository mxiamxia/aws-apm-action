# Example Workflow

This directory contains an example workflow file for the Application Observability for AWS action.

## `claude-bedrock.yml` - Claude Code with Amazon Bedrock

**Best for:**
- Teams that want to bring their own Bedrock model
- Organizations with existing AWS Bedrock access
- Users who want full control over model selection

**Key features:**
- Pay-per-token pricing on your AWS account
- Use any Claude model available in Bedrock
- Three-step workflow: prepare configuration, execute with `claude-code-base-action`, post results

**Cost:** Bedrock InvokeModel API charges (per-token usage)

## How to Use

1. Copy the `claude-bedrock.yml` file to `.github/workflows/awsapm.yml` in your repository
2. Configure the required secrets:
   - `AWSAPM_ROLE_ARN`: Your AWS IAM role ARN with OIDC trust
3. (Optional) Set repository variables:
   - `AWS_REGION`: Your preferred AWS region (default: us-east-1)
4. Customize the bot name if needed (e.g., `@awsapm-prod`, `@awsapm-staging`)

## Required AWS Permissions

The workflow requires these AWS permissions:
- Application Signals read access
- CloudWatch Logs, Metrics, Alarms read access
- CloudWatch Insights query execution (optional)
- `bedrock:InvokeModel`
- `bedrock:InvokeModelWithResponseStream`

See the main [README.md](../../../README.md#required-permissions) for detailed permission policies.

## Customization

### Different Environments

You can create multiple workflows for different environments:

```yaml
# .github/workflows/awsapm-prod.yml
with:
  bot_name: "@awsapm-prod"
  # ... configure with production IAM role and region

# .github/workflows/awsapm-staging.yml
with:
  bot_name: "@awsapm-staging"
  # ... configure with staging IAM role and region
```

### Different Models

You can specify different Claude models available in Bedrock:

```yaml
model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0"  # Latest Sonnet 4.5
model: "us.anthropic.claude-opus-4-0-20250514-v1:0"    # Opus 4.0
```

Check [Amazon Bedrock model IDs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html) for available models in your region.
