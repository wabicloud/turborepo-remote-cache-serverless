# ☁️ Turborepo Remote Cache — Serverless on AWS

**Deploy your own Turborepo remote cache in under 2 minutes. One command. No servers. Your AWS account.**

You love Turborepo but your infrastructure runs on AWS, not Vercel? This package deploys a fully serverless remote cache into your own AWS account — built on S3, Lambda, and Secrets Manager. No vendor lock-in, no extra SaaS subscriptions, just your existing AWS setup. It handles large monorepo artifacts without breaking a sweat and costs next to nothing for most teams.

- 🚀 **One command deploy** — `npx @wabicloud/turborepo-remote-cache-serverless@latest deploy` and you're done
- 🏗️ **Built for AWS teams** — uses services you already know and trust, works with your existing IAM profiles
- 💰 **Pays for itself** — typically under $1/month, and the CI minutes you save will most likely more than cover it
- 🔒 **Your data, your account** — artifacts stay in your own S3 bucket, no third-party access
- 🔍 **Transparent** — shows a full resource diff before every deployment

> **Important:** This cache requires Turborepo's `--preflight` mode. Without it, Turborepo will try to upload/download artifacts directly through the Lambda, which is not supported. See [Configure Turborepo](#configure-turborepo) below.

## Quick Start

### Option A: One-liner deployment (no CDK project needed)

```bash
npx @wabicloud/turborepo-remote-cache-serverless@latest deploy --region eu-central-1 --expiration 14
```

With a named AWS profile:

```bash
AWS_PROFILE=myprofile npx @wabicloud/turborepo-remote-cache-serverless@latest deploy --region eu-central-1 --expiration 14
```

This deploys the entire stack (S3, Lambda, Secrets Manager) into your AWS account. No CDK project required.

To tear it down:

```bash
npx @wabicloud/turborepo-remote-cache-serverless@latest destroy
```

### Option B: CDK construct

If you already have a CDK project and want to integrate the cache into your stack:

```bash
npm install @wabicloud/turborepo-remote-cache-serverless
```

```typescript
import { TurborepoRemoteCache } from "@wabicloud/turborepo-remote-cache-serverless";

const cache = new TurborepoRemoteCache(this, "TurboCache");

new cdk.CfnOutput(this, "TurboCacheUrl", {
  value: cache.functionUrl.url,
});
```

```bash
cdk deploy
```

### Generate a token

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

## Configuration

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `expiration` | `Duration` | 30 days | How long cached artifacts are kept |
| `secretName` | `string` | `turborepo-cache/token-secret` | Secrets Manager secret name |

> **Note:** Changing `secretName` creates a new secret with a new signing key. All existing tokens will be invalidated and must be regenerated.

```typescript
new TurborepoRemoteCache(this, "TurboCache", {
  expiration: cdk.Duration.days(7),
  secretName: "my-project/turbo-token",
});
```

## How It Works

The construct creates:

- **S3 bucket** - stores cached build artifacts with automatic expiration
- **Lambda function** with a public Function URL - handles Turborepo's remote cache API
- **Secrets Manager secret** - holds the JWT signing key for token authentication

Turborepo with `preflight: true` sends an OPTIONS request to get a presigned S3 URL, then uploads/downloads directly to S3. This means the Lambda only handles lightweight auth + URL generation, while S3 handles the heavy lifting.

**Without preflight, Turborepo will attempt direct PUT/GET requests to the Lambda, which will return 404.** Preflight mode is not optional with this cache.

## CLI Reference

All commands use the standard AWS credential chain. Set `AWS_PROFILE` to use a named profile.

### `deploy`

```
wabicloud-turbo-cache deploy

Flags:
  --region        AWS region                               [default: SDK default chain]
  --stack-name    CloudFormation stack name                 [default: wabicloud-turbo-cache]
  --secret-name   Secrets Manager secret name              [default: turborepo-cache/token-secret]
  --expiration    Cache TTL in days                        [default: 30]
  --yes / -y      Skip diff confirmation and deploy immediately
```

Shows a full resource diff before deploying and asks for confirmation. Use `--yes` to skip (e.g. in CI). Re-run with different flags to update an existing stack (e.g. `--expiration 30`).

### `destroy`

```
wabicloud-turbo-cache destroy

Flags:
  --region        AWS region                               [default: SDK default chain]
  --stack-name    CloudFormation stack name                 [default: wabicloud-turbo-cache]
  --yes / -y      Skip confirmation prompt
```

### `generate-token`

```
wabicloud-turbo-cache generate-token

Flags:
  --team          Team ID (must start with "team_")       [required]
  --secret-name   Secrets Manager secret name              [default: turborepo-cache/token-secret]
  --region        AWS region                               [default: eu-central-1]
```

## Exposed Properties

The construct exposes these for further customization:

- `cache.functionUrl` - Lambda Function URL (use `.url` for the endpoint)
- `cache.secret` - Secrets Manager secret
- `cache.bucket` - S3 bucket

## License

MIT
