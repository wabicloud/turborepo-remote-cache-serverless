import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { TurborepoRemoteCache } from "../src/construct";

function synthCdkApp(envOverrides: Record<string, string> = {}) {
  const env: Record<string, string> = {
    TURBO_CACHE_STACK_NAME: "test-stack",
    CDK_DEFAULT_ACCOUNT: "123456789012",
    CDK_DEFAULT_REGION: "us-east-1",
    ...envOverrides,
  };

  const app = new cdk.App();
  const stack = new cdk.Stack(app, env.TURBO_CACHE_STACK_NAME, {
    env: {
      account: env.CDK_DEFAULT_ACCOUNT,
      region: env.CDK_DEFAULT_REGION,
    },
  });

  const cache = new TurborepoRemoteCache(stack, "Cache", {
    expiration: cdk.Duration.days(
      Number(env.TURBO_CACHE_EXPIRATION || "30")
    ),
    secretName: env.TURBO_CACHE_SECRET_NAME || "turborepo-cache/token-secret",
  });

  new cdk.CfnOutput(stack, "FunctionUrl", { value: cache.functionUrl.url });
  new cdk.CfnOutput(stack, "SecretName", { value: cache.secret.secretName });
  new cdk.CfnOutput(stack, "BucketName", { value: cache.bucket.bucketName });

  return Template.fromStack(stack);
}

describe("CDK app entry point", () => {
  it("contains expected resource types", () => {
    const template = synthCdkApp();
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.resourceCountIs("AWS::Lambda::Url", 1);
    template.resourceCountIs("AWS::SecretsManager::Secret", 1);
    template.resourceCountIs("AWS::Logs::LogGroup", 1);
  });

  it("has CfnOutputs for FunctionUrl, SecretName, and BucketName", () => {
    const template = synthCdkApp();
    template.hasOutput("FunctionUrl", {});
    template.hasOutput("SecretName", {});
    template.hasOutput("BucketName", {});
  });

  it("uses default values when env vars are not set", () => {
    const template = synthCdkApp();
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "turborepo-cache/token-secret",
    });
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: [
          Match.objectLike({
            ExpirationInDays: 30,
          }),
        ],
      },
    });
  });

  it("respects custom expiration from env var", () => {
    const template = synthCdkApp({ TURBO_CACHE_EXPIRATION: "7" });
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: [
          Match.objectLike({
            ExpirationInDays: 7,
          }),
        ],
      },
    });
  });

  it("respects custom secret name from env var", () => {
    const template = synthCdkApp({
      TURBO_CACHE_SECRET_NAME: "custom/secret",
    });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "custom/secret",
    });
  });
});
