import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

declare const __dirname: string;

interface DeployArgs {
  region?: string;
  stackName: string;
  secretName: string;
  expiration: string;
}

function usage(): never {
  console.error(`Usage: wabicloud-turbo-cache deploy [flags]

Flags:
  --region        AWS region (default: AWS SDK default chain)
  --stack-name    CloudFormation stack name (default: wabicloud-turbo-cache)
  --secret-name   Secrets Manager secret name (default: turborepo-cache/token-secret)
  --expiration    Cache TTL in days (default: 30)

Uses the standard AWS credential chain (env vars, profiles, instance roles).
Set AWS_PROFILE to use a named profile.`);
  process.exit(1);
}

function parseArgs(argv: string[]): DeployArgs {
  let region: string | undefined;
  let stackName = "wabicloud-turbo-cache";
  let secretName = "turborepo-cache/token-secret";
  let expiration = "30";

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
      default:
        console.error(`Unknown flag: ${argv[i]}`);
        usage();
    }
  }

  return { region, stackName, secretName, expiration };
}

function resolveCdkBin(): string {
  return require.resolve("aws-cdk/bin/cdk");
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
  const { region, stackName, secretName, expiration } = parseArgs(argv);

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
  };

  console.log("Bootstrapping CDK toolkit (first-time only)...\n");
  runCdk(
    ["bootstrap", `aws://${account}/${resolvedRegion}`],
    cdkEnv
  );

  const outputsFile = join(tmpdir(), `turbo-cache-outputs-${Date.now()}.json`);

  console.log("\nDeploying wabicloud-turbo-cache...\n");
  runCdk(
    [
      "deploy",
      "--app",
      `node ${cdkAppPath}`,
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
        `\nNext: npx wabicloud-turbo-cache generate-token --team team_myproject --region ${resolvedRegion}\n`
      );
    }
  } catch {
    console.log(
      "\nDeployment complete. Check the AWS Console for stack outputs.\n"
    );
  }
}
