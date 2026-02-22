import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface DeployArgs {
  region?: string;
  stackName: string;
  secretName: string;
  expiration: string;
  reservedConcurrency?: string;
  logRequests: boolean;
  yes: boolean;
}

function usage(): never {
  console.error(`Usage: wabicloud-turbo-cache deploy [flags]

Flags:
  --region        AWS region (default: AWS SDK default chain)
  --stack-name    CloudFormation stack name (default: wabicloud-turbo-cache)
  --secret-name   Secrets Manager secret name (default: turborepo-cache/token-secret)
  --expiration    Cache TTL in days (default: 30)
  --reserved-concurrency   Max concurrent Lambda executions (default: no limit)
  --log-requests  Request logging in CloudWatch: on or off (default: off)
  --yes / -y      Skip diff confirmation and deploy immediately

Uses the standard AWS credential chain (env vars, profiles, instance roles).
Set AWS_PROFILE to use a named profile.`);
  process.exit(1);
}

function parseArgs(argv: string[]): DeployArgs {
  let region: string | undefined;
  let stackName = "wabicloud-turbo-cache";
  let secretName = "turborepo-cache/token-secret";
  let expiration = "30";
  let reservedConcurrency: string | undefined;
  let logRequests = false;
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--region":
        region = argv[++i];
        break;
      case "--stack-name":
        stackName = argv[++i];
        break;
      case "--secret-name":
        secretName = argv[++i];
        break;
      case "--expiration":
        expiration = argv[++i];
        break;
      case "--reserved-concurrency":
        reservedConcurrency = argv[++i];
        break;
      case "--log-requests": {
        const val = argv[++i];
        if (val !== "on" && val !== "off") {
          console.error("Error: --log-requests must be 'on' or 'off'");
          process.exit(1);
        }
        logRequests = val === "on";
        break;
      }
      case "--yes":
      case "-y":
        yes = true;
        break;
      default:
        console.error(`Unknown flag: ${argv[i]}`);
        usage();
    }
  }

  const expirationDays = Number(expiration);
  if (!Number.isInteger(expirationDays) || expirationDays < 1) {
    console.error("Error: --expiration must be a positive integer (days)");
    process.exit(1);
  }

  if (reservedConcurrency !== undefined) {
    const rc = Number(reservedConcurrency);
    if (!Number.isInteger(rc) || rc < 1) {
      console.error("Error: --reserved-concurrency must be a positive integer");
      process.exit(1);
    }
  }

  return { region, stackName, secretName, expiration, reservedConcurrency, logRequests, yes };
}

function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function resolveCdkBin(): string {
  return fileURLToPath(import.meta.resolve("aws-cdk/bin/cdk"));
}

function resolveCdkAppPath(): string {
  return join(__dirname, "cdk-app.js");
}

function runCdk(args: string[], env: Record<string, string>) {
  const cdkBin = resolveCdkBin();
  execFileSync(process.execPath, [cdkBin, ...args], {
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

export async function deploy(argv: string[]) {
  const { region, stackName, secretName, expiration, reservedConcurrency, logRequests, yes } = parseArgs(argv);

  const stsClient = new STSClient(region ? { region } : {});
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  const account = identity.Account!;
  const resolvedRegion =
    region || (await stsClient.config.region()) || "eu-central-1";

  console.log(
    `\nDeploying to account ${account} in region ${resolvedRegion}...\n`
  );

  const cdkAppPath = resolveCdkAppPath();
  const cdkEnv: Record<string, string> = {
    CDK_DEFAULT_ACCOUNT: account,
    CDK_DEFAULT_REGION: resolvedRegion,
    TURBO_CACHE_STACK_NAME: stackName,
    TURBO_CACHE_SECRET_NAME: secretName,
    TURBO_CACHE_EXPIRATION: expiration,
    ...(reservedConcurrency ? { TURBO_CACHE_RESERVED_CONCURRENCY: reservedConcurrency } : {}),
    ...(logRequests ? { TURBO_CACHE_LOG_REQUESTS: "true" } : {}),
  };

  console.log("Bootstrapping CDK toolkit (first-time only)...\n");
  runCdk(
    ["bootstrap", `aws://${account}/${resolvedRegion}`],
    cdkEnv
  );

  const cdkAppArgs = ["--app", `node ${cdkAppPath}`];

  console.log("\n=== Resource Changes ===\n");
  runCdk(["diff", ...cdkAppArgs], cdkEnv);

  if (!yes) {
    const confirmed = await confirm("\nProceed with deployment? (y/N) ");
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  const outputsFile = join(tmpdir(), `turbo-cache-outputs-${Date.now()}.json`);

  console.log("\nDeploying wabicloud-turbo-cache...\n");
  runCdk(
    [
      "deploy",
      ...cdkAppArgs,
      "--require-approval",
      "never",
      "--outputs-file",
      outputsFile,
    ],
    cdkEnv
  );

  try {
    const outputs = JSON.parse(readFileSync(outputsFile, "utf-8"));
    const stackOutputs = outputs[stackName];

    if (stackOutputs) {
      console.log("\n=== Deployment Complete ===\n");
      console.log(`  Function URL: ${stackOutputs.FunctionUrl}`);
      console.log(`  Secret Name:  ${stackOutputs.SecretName}`);
      console.log(`  Bucket:       ${stackOutputs.BucketName}`);
      console.log(
        `\nNext: npx @wabicloud/turborepo-remote-cache-serverless@latest generate-token --team team_myproject --region ${resolvedRegion}\n`
      );
    }
  } catch {
    console.log(
      "\nDeployment complete. Check the AWS Console for stack outputs.\n"
    );
  }
}
