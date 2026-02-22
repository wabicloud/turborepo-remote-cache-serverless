import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { S3RequestPresigner } from "@aws-sdk/s3-request-presigner";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { parseUrl } from "@smithy/url-parser";
import { formatUrl } from "@aws-sdk/util-format-url";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import * as jose from "jose";

const s3 = new S3Client({});
const secretsManager = new SecretsManagerClient({});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const BUCKET = requireEnv("CACHE_BUCKET");
const REGION = process.env.AWS_REGION || "eu-central-1";
const JWT_SECRET_ARN = requireEnv("TURBO_TOKEN_SECRET_ARN");
const PRESIGN_EXPIRY = 3600; // 1 hour
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LOG_ENABLED = process.env.LOG_REQUESTS === "true";

let cachedJwtSecret: string | null = null;
let cacheExpiresAt = 0;

async function getJwtSecret(): Promise<string> {
  if (cachedJwtSecret && Date.now() < cacheExpiresAt) {
    return cachedJwtSecret;
  }

  const response = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: JWT_SECRET_ARN })
  );
  const secret = response.SecretString;
  if (!secret) throw new Error("JWT secret is empty in Secrets Manager");
  cachedJwtSecret = secret;
  cacheExpiresAt = Date.now() + SECRET_CACHE_TTL_MS;
  return cachedJwtSecret;
}

interface TeamPayload {
  teamId: string;
}

async function authenticate(
  authorization: string,
  jwtSecret: string
): Promise<TeamPayload> {
  const token = authorization.replace("Bearer ", "");
  const secret = new TextEncoder().encode(jwtSecret);
  const { payload } = await jose.jwtVerify(token, secret);

  const teamId = payload.teamId as string;
  if (!teamId || !/^team_\w+$/.test(teamId)) {
    throw new Error("Invalid token: missing or invalid teamId");
  }

  return { teamId };
}

async function generatePresignedUrl(
  method: "GET" | "PUT",
  key: string,
  teamId: string
): Promise<string> {
  const presigner = new S3RequestPresigner({
    credentials: await s3.config.credentials(),
    region: REGION,
    sha256: Hash.bind(null, "sha256"),
  });

  const url = parseUrl(`https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`);
  const request = new HttpRequest({ ...url, method });

  // Turborepo adds &slug=<team> to presigned URLs after getting them
  // We must sign the slug param but not include it in returned URL
  request.query = { ...request.query, slug: teamId };

  const signedUrl = await presigner.presign(request, {
    expiresIn: PRESIGN_EXPIRY,
  });

  // Remove slug from URL - Turborepo will append it
  // formatUrl sorts alphabetically: slug comes after all X-Amz-* params
  const urlStr = formatUrl(signedUrl);
  const slugParam = "&slug=" + encodeURIComponent(teamId);
  const cleaned = urlStr.replace(slugParam, "");
  if (cleaned === urlStr) {
    throw new Error("Failed to strip slug parameter from presigned URL");
  }
  return cleaned;
}

interface LambdaEvent {
  requestContext: {
    http: {
      method: string;
      path: string;
    };
  };
  headers: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
}

interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export const handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
  const { method, path } = event.requestContext.http;

  if (LOG_ENABLED) {
    console.log(`${method} ${path}`);
  }

  // Status endpoint - no auth required
  if (method === "GET" && path === "/v8/artifacts/status") {
    return {
      statusCode: 200,
      body: JSON.stringify({ enabled: true }),
    };
  }

  // Analytics endpoint - just acknowledge
  if (method === "POST" && path === "/v8/artifacts/events") {
    return { statusCode: 200, body: "{}" };
  }

  // Artifact endpoints: /v8/artifacts/{hash}
  const artifactMatch = path.match(/^\/v8\/artifacts\/([a-fA-F0-9]+)$/);
  if (!artifactMatch) {
    return { statusCode: 404, body: "Not found" };
  }

  // Auth check - extract teamId from JWT
  const jwtSecret = await getJwtSecret();
  const authHeader = event.headers["authorization"] || "";

  let teamId: string;
  try {
    const decoded = await authenticate(authHeader, jwtSecret);
    teamId = decoded.teamId;
  } catch (e) {
    console.warn("Auth failed:", { path, error: (e as Error).message });
    return { statusCode: 401, body: "Unauthorized" };
  }

  const hash = artifactMatch[1];
  const key = `${teamId}/${hash}`;

  // Only handle OPTIONS for preflight - this is the key for large files!
  // Turborepo with --preflight will:
  // 1. Send OPTIONS to get presigned URL in Location header
  // 2. Then PUT/GET directly to S3 using that URL
  if (method === "OPTIONS") {
    const requestedMethod =
      event.headers["access-control-request-method"] ||
      event.headers["Access-Control-Request-Method"];

    if (requestedMethod === "GET") {
      // Check if artifact exists before returning URL
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      } catch (e: unknown) {
        if (
          e instanceof Error &&
          (e.name === "NotFound" || e.name === "NoSuchKey")
        ) {
          return { statusCode: 404, body: "Not found" };
        }
        console.warn("S3 HeadObject error:", { key, error: (e as Error).message });
        throw e;
      }
    }

    if (requestedMethod === "GET" || requestedMethod === "PUT") {
      try {
        const presignedUrl = await generatePresignedUrl(
          requestedMethod,
          key,
          teamId
        );

        return {
          statusCode: 200,
          headers: {
            location: presignedUrl,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
            // IMPORTANT: Do NOT include "Authorization" here!
            // Turborepo checks this header and if Authorization is allowed,
            // it sends the Auth header to the presigned S3 URL, causing 400 errors
            "Access-Control-Allow-Headers":
              "Content-Type, User-Agent, x-artifact-duration, x-artifact-tag",
          },
          body: "",
        };
      } catch (e) {
        console.error("Presign failed:", { method: requestedMethod, key, error: (e as Error).message });
        throw e;
      }
    }

    return { statusCode: 404, body: "Not found" };
  }

  // For non-preflight requests, return 404
  // This forces clients to use --preflight mode
  return { statusCode: 404, body: "Not found" };
};
