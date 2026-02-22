import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

// --- Mocks ---

const headObjectMock = vi.fn();
const getSecretValueMock = vi.fn();
const presignMock = vi.fn();

const credentialsMock = vi.fn().mockResolvedValue({
  accessKeyId: "test",
  secretAccessKey: "test",
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: headObjectMock,
    config: { credentials: credentialsMock },
  })),
  HeadObjectCommand: vi.fn().mockImplementation((input) => input),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn().mockImplementation(() => ({
    send: getSecretValueMock,
  })),
  GetSecretValueCommand: vi.fn().mockImplementation((input) => input),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  S3RequestPresigner: vi.fn().mockImplementation(() => ({
    presign: presignMock,
  })),
}));

vi.mock("@smithy/hash-node", () => ({
  Hash: { bind: vi.fn() },
}));

vi.mock("@smithy/protocol-http", () => ({
  HttpRequest: vi.fn().mockImplementation((opts) => ({
    ...opts,
    query: opts.query ?? {},
  })),
}));

vi.mock("@smithy/url-parser", () => ({
  parseUrl: vi.fn().mockReturnValue({
    hostname: "test-bucket.s3.eu-central-1.amazonaws.com",
    path: "/team_test/abc123",
    protocol: "https:",
    query: {},
  }),
}));

vi.mock("@aws-sdk/util-format-url", () => ({
  formatUrl: vi.fn().mockReturnValue(
    "https://test-bucket.s3.eu-central-1.amazonaws.com/team_test/abc123?X-Amz-Signature=sig&slug=team_test"
  ),
}));

// --- Helpers ---

const JWT_SECRET = "test-secret-key-for-testing-only";

async function makeToken(teamId: string): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({ teamId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(secret);
}

function makeEvent(
  method: string,
  path: string,
  headers: Record<string, string> = {}
) {
  return {
    requestContext: { http: { method, path } },
    headers,
    queryStringParameters: {},
  };
}

// --- Tests ---

describe("handler", () => {
  let handler: typeof import("../src/handler/index.ts").handler;

  beforeEach(async () => {
    vi.resetModules();

    process.env.CACHE_BUCKET = "test-bucket";
    process.env.AWS_REGION = "eu-central-1";
    process.env.TURBO_TOKEN_SECRET_ARN = "arn:aws:secretsmanager:eu-central-1:123456789:secret:test";

    getSecretValueMock.mockResolvedValue({ SecretString: JWT_SECRET });
    headObjectMock.mockResolvedValue({});
    presignMock.mockResolvedValue({
      hostname: "test-bucket.s3.eu-central-1.amazonaws.com",
      path: "/team_test/abc123",
      protocol: "https:",
      query: { "X-Amz-Signature": "sig" },
    });

    // Re-import to get fresh module with mocks
    const mod = await import("../src/handler/index");
    handler = mod.handler;
  });

  it("GET /v8/artifacts/status returns { enabled: true }", async () => {
    const res = await handler(makeEvent("GET", "/v8/artifacts/status"));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ enabled: true });
  });

  it("POST /v8/artifacts/events returns 200", async () => {
    const res = await handler(makeEvent("POST", "/v8/artifacts/events"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("{}");
  });

  it("OPTIONS with valid token + GET returns presigned URL in Location header", async () => {
    const token = await makeToken("team_test");
    const res = await handler(
      makeEvent("OPTIONS", "/v8/artifacts/abc123def456", {
        authorization: `Bearer ${token}`,
        "access-control-request-method": "GET",
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers?.location).toBeDefined();
    expect(res.headers?.location).not.toContain("slug=team_test");
  });

  it("OPTIONS with valid token + PUT returns presigned URL in Location header", async () => {
    const token = await makeToken("team_test");
    const res = await handler(
      makeEvent("OPTIONS", "/v8/artifacts/abc123def456", {
        authorization: `Bearer ${token}`,
        "access-control-request-method": "PUT",
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers?.location).toBeDefined();
  });

  it("OPTIONS with GET for non-existent artifact returns 404", async () => {
    const token = await makeToken("team_test");
    const err = new Error("Not found");
    err.name = "NotFound";
    headObjectMock.mockRejectedValueOnce(err);

    const res = await handler(
      makeEvent("OPTIONS", "/v8/artifacts/abc123def456", {
        authorization: `Bearer ${token}`,
        "access-control-request-method": "GET",
      })
    );
    expect(res.statusCode).toBe(404);
  });

  it("missing auth token returns 401", async () => {
    const res = await handler(
      makeEvent("OPTIONS", "/v8/artifacts/abc123def456", {
        "access-control-request-method": "GET",
      })
    );
    expect(res.statusCode).toBe(401);
  });

  it("invalid auth token returns 401", async () => {
    const res = await handler(
      makeEvent("OPTIONS", "/v8/artifacts/abc123def456", {
        authorization: "Bearer invalid-token",
        "access-control-request-method": "GET",
      })
    );
    expect(res.statusCode).toBe(401);
  });

  it("invalid teamId format in token returns 401", async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const badToken = await new SignJWT({ teamId: "badformat" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .sign(secret);

    const res = await handler(
      makeEvent("OPTIONS", "/v8/artifacts/abc123def456", {
        authorization: `Bearer ${badToken}`,
        "access-control-request-method": "GET",
      })
    );
    expect(res.statusCode).toBe(401);
  });

  it("unknown path returns 404", async () => {
    const res = await handler(makeEvent("GET", "/unknown/path"));
    expect(res.statusCode).toBe(404);
  });

  it("non-OPTIONS method on artifact path returns 404", async () => {
    const token = await makeToken("team_test");
    const res = await handler(
      makeEvent("GET", "/v8/artifacts/abc123def456", {
        authorization: `Bearer ${token}`,
      })
    );
    expect(res.statusCode).toBe(404);
  });

  it("CORS headers do not include Authorization in allowed headers", async () => {
    const token = await makeToken("team_test");
    const res = await handler(
      makeEvent("OPTIONS", "/v8/artifacts/abc123def456", {
        authorization: `Bearer ${token}`,
        "access-control-request-method": "PUT",
      })
    );
    expect(res.headers?.["Access-Control-Allow-Headers"]).not.toContain(
      "Authorization"
    );
    expect(res.headers?.["Access-Control-Allow-Origin"]).toBe("*");
  });
});
