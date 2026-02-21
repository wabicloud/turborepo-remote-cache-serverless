# @wabicloud/turborepo-remote-cache-serverless

An AWS CDK construct that deploys a fully serverless Turborepo remote cache using S3, Lambda, and Secrets Manager. No servers to manage, scales to zero, costs almost nothing for small teams.

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
npx wabicloud-turbo-cache generate-token \
  --team team_myproject \
  --secret-name turborepo/cache-token \
  --region us-east-1
```

### Configure Turborepo

```bash
export TURBO_API="https://<your-function-url>"
export TURBO_TOKEN="<generated-token>"
export TURBO_TEAM="team_myproject"

pnpm turbo build --preflight
```

## Configuration

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `expiration` | `Duration` | 30 days | How long cached artifacts are kept |
| `secretName` | `string` | `turborepo/cache-token` | Secrets Manager secret name |

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

Turborepo uses `--preflight` mode: it sends an OPTIONS request to get a presigned S3 URL, then uploads/downloads directly to S3. This means the Lambda only handles lightweight auth + URL generation, while S3 handles the heavy lifting.

## CLI Reference

```
wabicloud-turbo-cache generate-token

Flags:
  --team          Team ID (must start with "team_")       [required]
  --secret-name   Secrets Manager secret name              [default: turborepo/cache-token]
  --region        AWS region                               [default: us-east-1]
```

Uses the standard AWS credential chain. Set `AWS_PROFILE` for named profiles.

## Exposed Properties

The construct exposes these for further customization:

- `cache.functionUrl` - Lambda Function URL (use `.url` for the endpoint)
- `cache.secret` - Secrets Manager secret
- `cache.bucket` - S3 bucket

## License

MIT
