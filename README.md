# @wabicloud/turborepo-remote-cache-serverless

An AWS CDK construct that deploys a fully serverless Turborepo remote cache using S3, Lambda, and Secrets Manager. No servers to manage, scales to zero, costs almost nothing for small teams.

> **Important:** This cache requires Turborepo's `--preflight` mode. Without it, Turborepo will try to upload/download artifacts directly through the Lambda, which is not supported. See [Configure Turborepo](#configure-turborepo) below.

## Quick Start

### Install

```bash
npm install @wabicloud/turborepo-remote-cache-serverless
```

### Add to your CDK stack

```typescript
import { TurborepoRemoteCache } from "@wabicloud/turborepo-remote-cache-serverless";

const cache = new TurborepoRemoteCache(this, "TurboCache");

new cdk.CfnOutput(this, "TurboCacheUrl", {
  value: cache.functionUrl.url,
});
```

### Deploy

```bash
cdk deploy
```

### Generate a token

```bash
npx @wabicloud/turborepo-remote-cache-serverless generate-token \
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

```
wabicloud-turbo-cache generate-token

Flags:
  --team          Team ID (must start with "team_")       [required]
  --secret-name   Secrets Manager secret name              [default: turborepo-cache/token-secret]
  --region        AWS region                               [default: eu-central-1]
```

Uses the standard AWS credential chain. Set `AWS_PROFILE` for named profiles.

## Exposed Properties

The construct exposes these for further customization:

- `cache.functionUrl` - Lambda Function URL (use `.url` for the endpoint)
- `cache.secret` - Secrets Manager secret
- `cache.bucket` - S3 bucket

## License

MIT
