import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  signUrl: vi.fn(),
  clientConfig: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class MockCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  class MockS3Client {
    constructor(config: unknown) {
      mocks.clientConfig(config);
    }

    send(command: unknown) {
      return mocks.send(command);
    }
  }

  return {
    GetObjectCommand: MockCommand,
    PutObjectCommand: MockCommand,
    S3Client: MockS3Client,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => mocks.signUrl(...args),
}));

import { storageGetSignedUrl, storagePut } from "./storage";

const r2Values = {
  R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
  R2_REGION: "auto",
  R2_BUCKET: "intellmeet-test",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
};

function setR2Environment() {
  for (const [key, value] of Object.entries(r2Values)) {
    vi.stubEnv(key, value);
  }
  vi.stubEnv("MANUS_API_URL", "");
  vi.stubEnv("MANUS_API_KEY", "");
  vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://api.openai.com");
  vi.stubEnv("BUILT_IN_FORGE_API_KEY", "test-openai-key");
}

beforeEach(() => {
  vi.clearAllMocks();
  setR2Environment();
  mocks.send.mockResolvedValue({});
  mocks.signUrl.mockResolvedValue("https://signed.r2.example/object");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("R2 storage", () => {
  it("uploads objects through the S3 client and returns a stable app path", async () => {
    const bytes = Buffer.from("meeting attachment");
    const stored = await storagePut("copilot/user/file.txt", bytes, "text/plain");

    expect(stored.key).toMatch(/^copilot\/user\/file_[a-f0-9]{8}\.txt$/);
    expect(stored.url).toBe(`/manus-storage/${stored.key}`);
    expect(mocks.clientConfig).toHaveBeenCalledWith({
      endpoint: "https://account-id.r2.cloudflarestorage.com",
      region: "auto",
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
    });

    const command = mocks.send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Bucket: "intellmeet-test",
      Key: stored.key,
      ContentType: "text/plain",
    });
    expect(command.input.Body).toBe(bytes);
  });

  it("creates one-hour signed download URLs for stored objects", async () => {
    const url = await storageGetSignedUrl("meeting-intelligence/user/recording.webm");

    expect(url).toBe("https://signed.r2.example/object");
    const [, command, options] = mocks.signUrl.mock.calls[0] as [unknown, { input: Record<string, unknown> }, { expiresIn: number }];
    expect(command.input).toEqual({
      Bucket: "intellmeet-test",
      Key: "meeting-intelligence/user/recording.webm",
    });
    expect(options).toEqual({ expiresIn: 3600 });
  });

  it("fails clearly when only part of the R2 configuration is present", async () => {
    vi.stubEnv("R2_BUCKET", "");

    await expect(storagePut("file.txt", Buffer.from("data"))).rejects.toThrow("R2_BUCKET");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
