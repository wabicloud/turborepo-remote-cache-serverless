import { defineConfig } from "tsup";

export default defineConfig([
  // Construct (CJS + ESM with declarations)
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    outDir: "dist",
    external: ["aws-cdk-lib", "constructs"],
    shims: true,
    clean: true,
  },
  // Lambda handler (ESM bundle as asset)
  {
    entry: ["src/handler/index.ts"],
    format: ["esm"],
    outDir: "dist/handler",
    outExtension: () => ({ js: ".mjs" }),
    noExternal: ["jose"],
    external: [/^@aws-sdk\/client-/],
    bundle: true,
    minify: true,
    platform: "node",
    target: "node22",
    banner: {},
  },
  // CLI
  {
    entry: ["bin/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
    external: [/^@aws-sdk\//, /^aws-cdk/],
    bundle: true,
    platform: "node",
    target: "node22",
  },
  // CDK app (used by deploy/destroy commands)
  {
    entry: ["bin/cdk-app.ts"],
    format: ["esm"],
    outDir: "dist",
    external: [/^@aws-sdk\//, "aws-cdk-lib", /^aws-cdk-lib\//, "constructs"],
    bundle: true,
    shims: true,
    platform: "node",
    target: "node22",
  },
]);
