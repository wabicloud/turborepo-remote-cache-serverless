import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { TurborepoRemoteCache } from "../src/construct";

function synthTemplate(props?: ConstructorParameters<typeof TurborepoRemoteCache>[2]) {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, "TestStack");
  new TurborepoRemoteCache(stack, "Cache", props);
  return Template.fromStack(stack);
}

describe("TurborepoRemoteCache construct", () => {
  it("S3 bucket has lifecycle rule with default 30-day expiration", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: [
          Match.objectLike({
            ExpirationInDays: 30,
            Status: "Enabled",
          }),
        ],
      },
    });
  });

  it("S3 bucket has CORS configured", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: {
        CorsRules: [
          Match.objectLike({
            AllowedMethods: ["GET", "PUT"],
            AllowedOrigins: ["*"],
            AllowedHeaders: ["*"],
          }),
        ],
      },
    });
  });

  it("S3 bucket blocks public access", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("Lambda has correct environment variables", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          CACHE_BUCKET: Match.anyValue(),
          TURBO_TOKEN_SECRET_ARN: Match.anyValue(),
        },
      },
    });
  });

  it("Lambda has S3 read/write permissions", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["s3:GetObject*", "s3:PutObject"]),
            Effect: "Allow",
          }),
        ]),
      },
    });
  });

  it("Lambda has Secrets Manager read permission", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ]),
            Effect: "Allow",
          }),
        ]),
      },
    });
  });

  it("Function URL exists with NONE auth type", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "NONE",
    });
  });

  it("default props produce expected resource counts", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::S3::Bucket", 1);
    // 2 Lambdas: cache handler + autoDeleteObjects custom resource
    template.resourceCountIs("AWS::Lambda::Function", 2);
    template.resourceCountIs("AWS::SecretsManager::Secret", 1);
    template.resourceCountIs("AWS::Lambda::Url", 1);
  });

  it("custom expiration is reflected", () => {
    const template = synthTemplate({ expiration: cdk.Duration.days(7) });
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

  it("Lambda has 1024 MB memory", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::Lambda::Function", {
      MemorySize: 1024,
    });
  });

  it("custom secretName is reflected", () => {
    const template = synthTemplate({ secretName: "my-custom/secret" });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "my-custom/secret",
    });
  });
});
