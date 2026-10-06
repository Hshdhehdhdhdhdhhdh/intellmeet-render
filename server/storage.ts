import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { ENV } from "./_core/env";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

type R2StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type ManusStorageConfig = { forgeUrl: string; forgeKey: string };

function getR2StorageConfig(): R2StorageConfig | null {
  const endpointValue = process.env.R2_ENDPOINT?.trim() ?? "";
  const regionValue = process.env.R2_REGION?.trim() ?? "";
  const bucket = process.env.R2_BUCKET?.trim() ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";

  if (![endpointValue, regionValue, bucket, accessKeyId, secretAccessKey].some(Boolean)) {
    return null;
  }

  const missing = [
    ["R2_ENDPOINT", endpointValue],
    ["R2_BUCKET", bucket],
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`R2 storage is partially configured. Missing: ${missing.join(", ")}.`);
  }

  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new Error("R2_ENDPOINT must be a valid HTTPS endpoint URL.");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== "" && endpoint.pathname !== "/")
  ) {
    throw new Error("R2_ENDPOINT must be the HTTPS account endpoint, without credentials, path, query, or hash.");
  }

  return {
    endpoint: endpoint.origin,
    region: regionValue || "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

function createR2Client(config: R2StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function isManusApiUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "manus.ai" ||
      hostname.endsWith(".manus.ai") ||
      hostname === "manus.im" ||
      hostname.endsWith(".manus.im")
    );
  } catch {
    return false;
  }
}

function getManusStorageConfig(): ManusStorageConfig {
  const forgeUrl = (process.env.MANUS_API_URL ?? ENV.forgeApiUrl).trim();
  const forgeKey = (process.env.MANUS_API_KEY ?? ENV.forgeApiKey).trim();

  // Do not mistake an OpenAI-compatible LLM endpoint for a Manus storage service.
  if (forgeUrl && forgeKey && isManusApiUrl(forgeUrl)) {
    return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
  }

  throw new Error(
    "Object storage is not configured. On Render, set R2_ENDPOINT, R2_REGION, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.",
  );
}

function normalizeKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "");
  if (
    !key ||
    key.includes("\\") ||
    key.split("/").some((segment) => segment === "." || segment === "..") ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    throw new Error("Invalid storage key.");
  }
  return key;
}

function appendHashSuffix(relKey: string): string {
  const hash = randomUUID().replace(/-/g, "").slice(0, 8);
  const lastSlash = relKey.lastIndexOf("/");
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot <= lastSlash) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const r2 = getR2StorageConfig();

  if (r2) {
    await createR2Client(r2).send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: typeof data === "string" ? Buffer.from(data) : data,
        ContentType: contentType,
      }),
    );
    return { key, url: `/manus-storage/${key}` };
  }

  const { forgeUrl, forgeKey } = getManusStorageConfig();
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Storage service returned an empty presign URL");

  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  const r2 = getR2StorageConfig();

  if (r2) {
    return getSignedUrl(
      createR2Client(r2),
      new GetObjectCommand({ Bucket: r2.bucket, Key: key }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  }

  const { forgeUrl, forgeKey } = getManusStorageConfig();
  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  if (!url) throw new Error("Storage service returned an empty signed URL");
  return url;
}
