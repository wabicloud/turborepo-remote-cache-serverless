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
    external: [/^@aws-sdk\//, /^@smithy\//],
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
    external: [/^@aws-sdk\//],
    bundle: true,
    platform: "node",
    target: "node22",
  },
]);
