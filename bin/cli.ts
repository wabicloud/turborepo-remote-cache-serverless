import { SignJWT } from "jose";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

function usage(): never {
  console.error(`Usage: turborepo-remote-cache-serverless generate-token \\
  --team <team_id> \\
  --secret-name <secret_name> \\
  --region <aws_region>

Flags:
  --team         Team ID (must start with "team_"), e.g. team_myproject
  --secret-name  Secrets Manager secret name (default: turborepo/cache-token)
  --region       AWS region (default: us-east-1)

Uses the standard AWS credential chain (env vars, profiles, instance roles).
Set AWS_PROFILE to use a named profile.`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);

  if (args[0] !== "generate-token") {
    console.error(`Unknown command: ${args[0] ?? "(none)"}`);
    usage();
  }

  let team: string | undefined;
  let secretName = "turborepo/cache-token";
  let region = "us-east-1";

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--team":
        team = args[++i];
        break;
      case "--secret-name":
        secretName = args[++i];
        break;
      case "--region":
        region = args[++i];
        break;
      default:
        console.error(`Unknown flag: ${args[i]}`);
        usage();
    }
  }

  if (!team) {
    console.error("Error: --team is required");
    usage();
  }

  if (!/^team_\w+$/.test(team)) {
    console.error(
      'Error: Team ID must start with "team_" followed by alphanumeric characters'
    );
    console.error("Example: team_wabicloud, team_myproject");
    process.exit(1);
  }

  return { team, secretName, region };
}

async function main() {
  const { team, secretName, region } = parseArgs(process.argv);

  const client = new SecretsManagerClient({ region });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  const jwtSecret = response.SecretString;

  if (!jwtSecret) {
    console.error(
      "Error: Could not retrieve JWT secret from Secrets Manager"
    );
    process.exit(1);
  }

  const secretKey = new TextEncoder().encode(jwtSecret);
  const token = await new SignJWT({ teamId: team })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(secretKey);

  console.log("\n=== Turborepo Remote Cache Token ===\n");
  console.log(`Team: ${team}\n`);
  console.log("Add these to your environment:\n");
  console.log(`export TURBO_TOKEN="${token}"`);
  console.log(`export TURBO_TEAM="${team}"`);
  console.log(
    '\nSet TURBO_API to your Function URL, then run: pnpm turbo build --preflight\n'
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
