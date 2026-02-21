import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";

declare const __dirname: string;

interface DestroyArgs {
  region?: string;
  stackName: string;
  yes: boolean;
}

function usage(): never {
  console.error(`Usage: wabicloud-turbo-cache destroy [flags]

Flags:
  --region        AWS region (default: AWS SDK default chain)
  --stack-name    CloudFormation stack name (default: wabicloud-turbo-cache)
  --yes           Skip confirmation prompt

Uses the standard AWS credential chain (env vars, profiles, instance roles).
Set AWS_PROFILE to use a named profile.`);
  process.exit(1);
}

function parseArgs(argv: string[]): DestroyArgs {
  let region: string | undefined;
  let stackName = "wabicloud-turbo-cache";
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--region":
        region = argv[++i];
        break;
      case "--stack-name":
        stackName = argv[++i];
        break;
      case "--yes":
      case "-y":
        yes = true;
        break;
      default:
        console.error(`Unknown flag: ${argv[i]}`);
        usage();
    }
  }

  return { region, stackName, yes };
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function resolveCdkBin(): string {
  return require.resolve("aws-cdk/bin/cdk");
}

function resolveCdkAppPath(): string {
  return join(__dirname, "cdk-app.js");
}

export async function destroy(argv: string[]) {
  const { region, stackName, yes } = parseArgs(argv);

  if (!yes) {
    const confirmed = await confirm(
      `Are you sure you want to destroy stack "${stackName}"? (y/N) `
    );
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  const cdkBin = resolveCdkBin();
  const cdkAppPath = resolveCdkAppPath();
  const cdkEnv: Record<string, string> = {
    TURBO_CACHE_STACK_NAME: stackName,
  };
  if (region) {
    cdkEnv.CDK_DEFAULT_REGION = region;
  }

  console.log(`\nDestroying stack "${stackName}"...\n`);

  execFileSync(
    process.execPath,
    [cdkBin, "destroy", "--app", `node ${cdkAppPath}`, "--force"],
    {
      env: { ...process.env, ...cdkEnv },
      stdio: "inherit",
    }
  );

  console.log(`\nStack "${stackName}" destroyed successfully.\n`);
}
