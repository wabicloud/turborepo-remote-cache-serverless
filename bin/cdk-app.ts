import * as cdk from "aws-cdk-lib";
import { TurborepoRemoteCache } from "../src/construct.js";

const app = new cdk.App();
const stack = new cdk.Stack(
  app,
  process.env.TURBO_CACHE_STACK_NAME || "wabicloud-turbo-cache",
  {
    description: "WABI Cloud - Serverless Turborepo remote cache (S3 + Lambda + Secrets Manager) - https://github.com/wabicloud/turborepo-remote-cache-serverless",
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  }
);

const cache = new TurborepoRemoteCache(stack, "Cache", {
  expiration: cdk.Duration.days(
    Number(process.env.TURBO_CACHE_EXPIRATION || "30")
  ),
  secretName: process.env.TURBO_CACHE_SECRET_NAME || "turborepo-cache/token-secret",
});

new cdk.CfnOutput(stack, "FunctionUrl", { value: cache.functionUrl.url });
new cdk.CfnOutput(stack, "SecretName", { value: cache.secret.secretName });
new cdk.CfnOutput(stack, "BucketName", { value: cache.bucket.bucketName });

app.synth();
