# Security

This document outlines key security considerations when using the Application observability for AWS GitHub Action.

## 🔒 Access Control

### User Access Requirements

This action can only be triggered by users with **write access or above** to the repository. GitHub's workflow execution model enforces this:

- ✅ Repository collaborators with write/maintain/admin access
- ✅ Organization members with write permissions
- ❌ External contributors without write access (cannot trigger workflows)

### GitHub Token Permissions

The action uses GitHub's `GITHUB_TOKEN` to interact with your repository (posting comments, creating branches, reading files). It operates with strict security boundaries and requires the following permissions:

**Token Scope and Isolation:**
- **Repository-Scoped Tokens**: Each workflow run receives a temporary token automatically scoped to the specific repository where the action executes
- **No Cross-Repository Access**: The action cannot access or modify any repositories other than the one where it was invoked
- **Permission Boundaries**: Operations are restricted to only the explicitly granted permissions

**Currently Used Permissions:**
- **Contents (Write)**: For reading repository files and creating branches for PRs
- **Pull Requests (Write)**: For reading PR data and posting analysis comments on pull requests
- **Issues (Write)**: For reading issue data and posting investigation results as comments
- **ID Token (Write)**: For OIDC authentication with AWS (required when using `configure-aws-credentials`)

## ☁️ AWS IAM Permissions

**You need to use OpenID Connect (OIDC)** to authenticate with AWS, which provides short-lived credentials without storing long-term secrets in your repository. See the [Getting Started guide in README](README.md#-getting-started) for OIDC setup instructions.

### Security Best Practices

**Principle of Least Privilege:**
- Configure the IAM role with **minimum required permissions only**
- The action needs read access to CloudWatch, Application Signals, and invoke access of AI agent tools
- See `template/awsapm.yaml` for a reference IAM policy with minimal permissions

**⚠️ Important Security Considerations:**
- **Never grant write permissions** to CloudWatch Logs, metrics, or Application Signals unless absolutely necessary
- **Be cautious when adding additional permissions** beyond the minimal set - each permission increases security risk
- **Review the IAM policy regularly** to ensure no excessive permissions have been added
- **Enable AWS CloudTrail** to monitor and audit all API calls made by the action

## ⚠️ Prompt Injection Risks

This action processes user-provided content (issues, PRs, comments) using AI. **Malicious actors may attempt to inject hidden instructions** through HTML comments, markdown hidden text, or zero-width Unicode characters to manipulate the AI's behavior. To mitigate this risk, the action includes built-in protections: comment timestamp filtering (excludes comments edited after trigger), repository scope restriction (AI analyzes target repository only), sensitive data redaction (AI instructed not to output credentials), and output sanitization before posting to GitHub.

### Mitigation Best Practices

✅ **Review content from external contributors** before triggering the action
✅ **Check for suspicious HTML comments or hidden content**
✅ **Use specific trigger phrases** (e.g., `@awsapm`) instead of automatic triggers
✅ **Monitor AI responses** for unexpected behavior
✅ **Never include sensitive information** in issues/PRs that trigger the action

**Note:** New prompt injection techniques may emerge. Stay vigilant and review untrusted content.

## 🔐 General Security Best Practices

### Workflow Security
- ✅ Pin action versions (e.g., `@v1.0.0` not `@main`) for reproducibility and security
- ✅ Review workflow changes in PRs before merging
- ✅ Monitor workflow execution logs for anomalies

### Credential Management
- ✅ Store any additional secrets in GitHub Secrets (never hardcode in workflow files)
- ✅ Rotate credentials regularly
- ❌ Never use root AWS account credentials

## 🛡️ Reporting Security Issues

If you discover a security vulnerability:
1. **Do not** create a public GitHub issue
2. Contact maintainers privately (see repository for contact info)
3. Allow reasonable time for fixes before public disclosure
