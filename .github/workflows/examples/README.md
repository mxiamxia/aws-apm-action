# Example Workflows

This directory contains example workflow files for different configurations of the Application Observability for AWS action.

## Available Examples

### 1. `claude-bedrock.yml` - Claude Code with Amazon Bedrock (Recommended)

**Best for:**
- Teams that want to bring their own Bedrock model
- Organizations with existing AWS Bedrock access
- Users who want full control over model selection

**Key features:**
- Pay-per-token pricing on your AWS account
- Use any Claude model available in Bedrock
- Two-step workflow: preparation + execution with `claude-code-base-action`

**Cost:** Bedrock InvokeModel API charges (per-token usage)

### 2. `amazon-q.yml` - Amazon Q Developer CLI

**Best for:**
- Quick setup with minimal configuration
- Teams already using Amazon Q
- Projects within the free tier limits

**Key features:**
- Free tier: ~1,000 requests/month per AWS account
- One-step execution
- Simple workflow configuration

**Cost:** Free tier available, then per-request pricing

## How to Use

1. Choose the example that fits your needs
2. Copy the file to `.github/workflows/awsapm.yml` in your repository
3. Configure the required secrets:
   - `AWSAPM_ROLE_ARN`: Your AWS IAM role ARN with OIDC trust
4. (Optional) Set repository variables:
   - `AWS_REGION`: Your preferred AWS region (default: us-east-1)
5. Customize the bot name if needed (e.g., `@awsapm-prod`, `@awsapm-staging`)

## Comparison

| Feature | Claude + Bedrock | Amazon Q |
|---------|------------------|----------|
| **Setup Complexity** | Medium (two-step workflow) | Low (one-step workflow) |
| **Cost Model** | Per-token (Bedrock API) | Free tier + per-request |
| **Model Selection** | Any Bedrock Claude model | Fixed (Amazon Q) |
| **Free Tier** | No | Yes (~1,000 requests/month) |
| **AWS Account Billing** | Yes | After free tier |
| **CLI Installation** | None (uses claude-code-action) | Automatic |

## Required AWS Permissions

Both examples require these base AWS permissions:
- Application Signals read access
- CloudWatch Logs, Metrics, Alarms read access
- (Optional) CloudWatch Insights query execution

**Claude + Bedrock additionally requires:**
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

For Claude + Bedrock, you can specify different models:

```yaml
bedrock_model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0"  # Latest Sonnet 4.5
bedrock_model: "us.anthropic.claude-opus-4-0-20250514-v1:0"    # Opus 4.0
```

Check [Amazon Bedrock model IDs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html) for available models in your region.
