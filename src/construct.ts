import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { join } from "node:path";

// Resolve the directory containing this file at runtime.
// In ESM (tsup shims) and CJS, __dirname is available.
declare const __dirname: string;

export interface TurborepoRemoteCacheProps {
  /**
   * How long cached artifacts are kept before automatic deletion.
   * @default Duration.days(30)
   */
  readonly expiration?: cdk.Duration;

  /**
   * Name of the Secrets Manager secret that stores the JWT signing key.
   * @default 'turborepo-cache/token-secret'
   */
  readonly secretName?: string;

  /**
   * Maximum concurrent Lambda executions. Limits runaway costs from abuse.
   * Must leave at least 10 unreserved concurrent executions in your account.
   * @default - no reservation (uses unreserved account concurrency)
   */
  readonly reservedConcurrency?: number;

  /**
   * Enable request logging (method, team, hash) for each presigned URL.
   * @default false
   */
  readonly logRequests?: boolean;
}

export class TurborepoRemoteCache extends Construct {
  /** The Lambda Function URL endpoint (use as TURBO_API). */
  public readonly functionUrl: lambda.FunctionUrl;

  /** The Secrets Manager secret holding the JWT signing key. */
  public readonly secret: secretsmanager.Secret;

  /** The S3 bucket storing cached artifacts. */
  public readonly bucket: s3.Bucket;

  constructor(
    scope: Construct,
    id: string,
    props: TurborepoRemoteCacheProps = {}
  ) {
    super(scope, id);

    const {
      expiration = cdk.Duration.days(30),
      secretName = "turborepo-cache/token-secret",
      reservedConcurrency,
      logRequests = false,
    } = props;

    // S3 Bucket for cache
    this.bucket = new s3.Bucket(this, "Bucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
    });

    // Secret for auth token
    this.secret = new secretsmanager.Secret(this, "TurboToken", {
      secretName,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // Lambda Function
    const cacheHandler = new lambda.Function(this, "CacheHandler", {
      description: "Turborepo remote cache API - handles auth and S3 presigned URLs",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(join(__dirname, "handler")),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: reservedConcurrency,
      environment: {
        CACHE_BUCKET: this.bucket.bucketName,
        TURBO_TOKEN_SECRET_ARN: this.secret.secretArn,
        ...(logRequests ? { LOG_REQUESTS: "true" } : {}),
      },
    });

    // Log Group with 1 month retention
    new logs.LogGroup(this, "CacheHandlerLogGroup", {
      logGroupName: `/aws/lambda/${cacheHandler.functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Grant permissions
    this.bucket.grantReadWrite(cacheHandler);
    this.secret.grantRead(cacheHandler);

    // Function URL
    this.functionUrl = cacheHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
  }
}
