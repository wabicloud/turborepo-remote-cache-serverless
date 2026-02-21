const command = process.argv[2];
const args = process.argv.slice(3);

function usage(): never {
  console.error(`Usage: wabicloud-turbo-cache <command> [flags]

Commands:
  deploy           Deploy the Turborepo remote cache to AWS
  destroy          Destroy the deployed cache stack
  generate-token   Generate a Turborepo auth token

Run 'wabicloud-turbo-cache <command> --help' for command-specific help.`);
  process.exit(1);
}

async function main() {
  switch (command) {
    case "deploy": {
      const { deploy } = await import("./commands/deploy.js");
      await deploy(args);
      break;
    }
    case "destroy": {
      const { destroy } = await import("./commands/destroy.js");
      await destroy(args);
      break;
    }
    case "generate-token": {
      const { generateToken } = await import("./commands/generate-token.js");
      await generateToken(args);
      break;
    }
    default:
      if (command) console.error(`Unknown command: ${command}\n`);
      usage();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
