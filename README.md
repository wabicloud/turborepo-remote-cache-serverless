# ☁️ Turborepo Remote Cache — Serverless on AWS

**Deploy your own Turborepo remote cache in under 2 minutes. One command. No servers. Your AWS account.**

You love Turborepo but your infrastructure runs on AWS, not Vercel? This package deploys a fully serverless remote cache into your own AWS account — built on S3, Lambda, and Secrets Manager. No vendor lock-in, no extra SaaS subscriptions, just your existing AWS setup. It handles large monorepo artifacts without breaking a sweat and costs next to nothing for most teams.

- 🚀 **One command deploy** — `npx @wabicloud/turborepo-remote-cache-serverless@latest deploy` and you're done
- 🏗️ **Built for AWS teams** — uses services you already know and trust, works with your existing IAM profiles
- 💰 **Pays for itself** — ~$0.40/month baseline (Secrets Manager) plus pennies for S3 and Lambda, and the CI minutes you save will most likely more than cover it
- 🔒 **Your data, your account** — artifacts stay in your own S3 bucket, no third-party access
- 🔍 **Transparent** — shows a full resource diff before every deployment

> **Important:** This cache requires Turborepo's `--preflight` mode. Without it, Turborepo will try to upload/download artifacts directly through the Lambda, which is not supported. See [Configure Turborepo](#configure-turborepo) below.

## Quick Start

1. **Deploy the stack** using Option A or B below
2. **Generate a token** for each team/project that needs cache access
3. **Configure Turborepo** in your project to use the cache endpoint and token

### Option A: One-liner deployment (no CDK project needed)

```bash
npx @wabicloud/turborepo-remote-cache-serverless@latest deploy --region eu-central-1 --expiration 14
```

With a named AWS profile:

```bash
AWS_PROFILE=myprofile npx @wabicloud/turborepo-remote-cache-serverless@latest deploy --region eu-central-1 --expiration 14
```

This deploys the entire stack (S3, Lambda, Secrets Manager) into your AWS account. No CDK project required. See [CLI Reference](#cli-reference) for all available flags.

### Option B: CDK construct

If you already have a CDK project and want to integrate the cache into your stack:

```bash
npm install @wabicloud/turborepo-remote-cache-serverless
```

```typescript
import { TurborepoRemoteCache } from "@wabicloud/turborepo-remote-cache-serverless";

const cache = new TurborepoRemoteCache(this, "TurboCache", {
  expiration: cdk.Duration.days(30),          // optional, default: 30 days
  secretName: "turborepo-cache/token-secret", // optional, default: "turborepo-cache/token-secret"
  reservedConcurrency: 10,                    // optional, default: no limit
  logRequests: true,                          // optional, default: false
});

new cdk.CfnOutput(this, "TurboCacheUrl", {
  value: cache.functionUrl.url,
});
```

```bash
cdk deploy
```

All props are optional — sensible defaults are provided. See [CDK Configuration](#cdk-configuration) for customization options.

### Generate a token

Turborepo requires a `--team` parameter to namespace cached artifacts — each team gets its own prefix in the S3 bucket to keep cache files separate. Most people use one token per project (e.g. `team_projectA`, `team_projectB`), but you can also just use a single token for everything if you prefer. Tokens can be regenerated at any time — the signing key stays the same.

```bash
AWS_PROFILE=myprofile npx @wabicloud/turborepo-remote-cache-serverless@latest generate-token \
  --team team_myproject \
  --region eu-central-1
```

### Configure Turborepo

This cache only works with `--preflight` enabled. You have two options:

**Option A: Environment variables + CLI flag**

```bash
export TURBO_API="https://<your-function-url>"
export TURBO_TOKEN="<generated-token>"
export TURBO_TEAM="team_myproject"

pnpm turbo build --preflight
```

**Option B: `turbo.json` (recommended)**

Add the remote cache configuration to your `turbo.json` so every team member and CI job gets it automatically:

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "remoteCache": {
    "enabled": true,
    "preflight": true,   // required - will not work without this
    "apiUrl": "https://<your-function-url>"
  }
}
```

Then set the remaining values via environment variables:

```bash
export TURBO_TOKEN="<generated-token>"
export TURBO_TEAM="team_myproject"

pnpm turbo build
```

## CDK Configuration

All props are optional. The construct works with zero configuration out of the box.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `expiration` | `cdk.Duration` | `Duration.days(30)` | How long cached artifacts are kept before automatic deletion |
| `secretName` | `string` | `"turborepo-cache/token-secret"` | Secrets Manager secret name |
| `reservedConcurrency` | `number` | no limit | Max concurrent Lambda executions. Must leave at least 10 unreserved in your account |
| `logRequests` | `boolean` | `false` | Log each request (method, team, artifact hash) to CloudWatch |

> **Note:** Changing `secretName` creates a new secret with a new signing key. All existing tokens will be invalidated and must be regenerated.

```typescript
new TurborepoRemoteCache(this, "TurboCache", {
  expiration: cdk.Duration.days(7),
  secretName: "my-project/turbo-token",
  reservedConcurrency: 10,
  logRequests: true,
});
```

## How It Works

The construct creates:

- **S3 bucket** — stores cached build artifacts with automatic expiration
- **Lambda function** with a public Function URL — handles Turborepo's remote cache API
- **Secrets Manager secret** — holds the JWT signing key for token authentication

Turborepo with `preflight: true` sends an OPTIONS request to get a presigned S3 URL, then uploads/downloads directly to S3. This means the Lambda only handles lightweight auth + URL generation, while S3 handles the heavy lifting.

**Without preflight, Turborepo will attempt direct PUT/GET requests to the Lambda, which will return 404.** Preflight mode is not optional with this cache.

## CLI Reference

All commands use the standard AWS credential chain. Set `AWS_PROFILE` to use a named profile.

### `deploy`

Deploys the cache stack. Shows a full resource diff before deploying and asks for confirmation. Re-run with different flags to update an existing stack.

```
wabicloud-turbo-cache deploy [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--region` | AWS SDK default | AWS region to deploy to |
| `--stack-name` | `wabicloud-turbo-cache` | CloudFormation stack name |
| `--secret-name` | `turborepo-cache/token-secret` | Secrets Manager secret name |
| `--expiration` | `30` | Cache artifact TTL in days |
| `--reserved-concurrency` | no limit | Max concurrent Lambda executions |
| `--log-requests` | `off` | `on` or `off` — log each request (method, team, hash) to CloudWatch |
| `--yes` / `-y` | | Skip diff confirmation (useful for CI) |

Example with logging and concurrency limit:

```bash
npx @wabicloud/turborepo-remote-cache-serverless@latest deploy \
  --region eu-central-1 \
  --expiration 14 \
  --reserved-concurrency 10 \
  --log-requests on
```

### `destroy`

Destroys the cache stack.

> **Warning:** This permanently deletes the S3 bucket with all cached artifacts, the Lambda function, and the Secrets Manager secret. All existing tokens will stop working.

```
wabicloud-turbo-cache destroy [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--region` | AWS SDK default | AWS region |
| `--stack-name` | `wabicloud-turbo-cache` | CloudFormation stack name |
| `--yes` / `-y` | | Skip confirmation prompt |

### `generate-token`

Generates a JWT token for a team. The token is signed with the secret stored in Secrets Manager.

```
wabicloud-turbo-cache generate-token [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--team` | _(required)_ | Team ID, must start with `team_` (e.g. `team_myproject`) |
| `--secret-name` | `turborepo-cache/token-secret` | Secrets Manager secret name |
| `--region` | `eu-central-1` | AWS region |

## Exposed Properties

The construct exposes these for further customization in your CDK stack:

- `cache.functionUrl` — Lambda Function URL (use `.url` for the endpoint string)
- `cache.secret` — Secrets Manager secret
- `cache.bucket` — S3 bucket

## License

MIT

---

<div align="center">

**Built by [WABI Engineering](https://wabi-tech.com)** — AWS consulting for teams that ship fast

[www.wabi-tech.com](https://www.wabi-tech.com)

</div>
