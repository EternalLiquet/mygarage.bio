import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BUCKET_NAME } from "@/lib/storage";

const DEFAULT_SIGNED_URL_TTL_SECONDS = 10 * 60;
const SIGNED_URL_CACHE_SAFETY_MS = 15_000;
const BUCKET_PUBLIC_CACHE_TTL_MS = 10 * 60 * 1000;

let anonStorageClient: SupabaseClient | null = null;
let serviceStorageClient: SupabaseClient | null = null;

const bucketPublicCache = new Map<
  string,
  { isPublic: boolean; expiresAt: number }
>();
const publicUrlCache = new Map<string, string>();
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

type PublicImageUrlInput = {
  bucket?: string | null;
  storagePath: string | null | undefined;
};

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function getSignedUrlTtlSeconds(): number {
  const configured = process.env.PUBLIC_IMAGE_SIGNED_URL_TTL_SECONDS;
  if (!configured) {
    return DEFAULT_SIGNED_URL_TTL_SECONDS;
  }

  const parsed = Number.parseInt(configured, 10);
  if (!Number.isFinite(parsed) || parsed < 30) {
    return DEFAULT_SIGNED_URL_TTL_SECONDS;
  }

  return Math.floor(parsed);
}

const SIGNED_URL_TTL_SECONDS = getSignedUrlTtlSeconds();

function getSiteUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) {
    return null;
  }
  return configured.replace(/\/$/, "");
}

function getSupabaseUrl(): string | null {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return null;
  }
  return supabaseUrl.replace(/\/$/, "");
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function toAbsoluteUrl(value: string): string {
  if (isAbsoluteUrl(value)) {
    return value;
  }

  const siteUrl = getSiteUrl();
  if (siteUrl && value.startsWith("/")) {
    return `${siteUrl}${value}`;
  }

  return value;
}

function normalizeStoragePath(storagePath: string | null | undefined): string | null {
  const trimmed = storagePath?.trim();
  if (!trimmed) {
    return null;
  }
  if (isAbsoluteUrl(trimmed)) {
    return trimmed;
  }
  return trimSlashes(trimmed);
}

function toStoragePublicUrl(bucket: string, storagePath: string): string | null {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    return null;
  }

  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${supabaseUrl}/storage/v1/object/public/${encodedBucket}/${encodedPath}`;
}

function normalizeBucketName(bucket: string | null | undefined): string {
  const trimmed = bucket?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : BUCKET_NAME;
}

function toObjectCacheKey(bucket: string, storagePath: string): string {
  return `${normalizeBucketName(bucket)}::${storagePath}`;
}

function getCachedSignedUrl(bucket: string, storagePath: string): string | null {
  const key = toObjectCacheKey(bucket, storagePath);
  const entry = signedUrlCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now() + SIGNED_URL_CACHE_SAFETY_MS) {
    signedUrlCache.delete(key);
    return null;
  }

  return entry.url;
}

function setCachedSignedUrl(bucket: string, storagePath: string, url: string) {
  const key = toObjectCacheKey(bucket, storagePath);
  signedUrlCache.set(key, {
    url,
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
  });
}

function getAnonStorageClient(): SupabaseClient | null {
  if (anonStorageClient) {
    return anonStorageClient;
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  anonStorageClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return anonStorageClient;
}

function getServiceStorageClient(): SupabaseClient | null {
  if (serviceStorageClient) {
    return serviceStorageClient;
  }

  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  serviceStorageClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return serviceStorageClient;
}

export function getPublicImageUrl(
  bucket: string = BUCKET_NAME,
  storagePath: string | null | undefined
): string | null {
  const normalizedBucket = normalizeBucketName(bucket);
  const normalizedPath = normalizeStoragePath(storagePath);
  if (!normalizedPath) {
    return null;
  }

  if (isAbsoluteUrl(normalizedPath)) {
    return normalizedPath;
  }

  const cacheKey = toObjectCacheKey(normalizedBucket, normalizedPath);
  const cachedUrl = publicUrlCache.get(cacheKey);
  if (cachedUrl) {
    return cachedUrl;
  }

  const client = getAnonStorageClient();
  if (client) {
    const {
      data: { publicUrl },
    } = client.storage.from(normalizedBucket).getPublicUrl(normalizedPath);
    if (publicUrl) {
      const resolved = toAbsoluteUrl(publicUrl);
      publicUrlCache.set(cacheKey, resolved);
      return resolved;
    }
  }

  const fallback = toStoragePublicUrl(normalizedBucket, normalizedPath);
  if (!fallback) {
    return null;
  }

  const resolved = toAbsoluteUrl(fallback);
  publicUrlCache.set(cacheKey, resolved);
  return resolved;
}

async function isBucketPublic(bucket: string): Promise<boolean> {
  const normalizedBucket = normalizeBucketName(bucket);
  const cached = bucketPublicCache.get(normalizedBucket);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.isPublic;
  }

  const serviceClient = getServiceStorageClient();
  if (!serviceClient) {
    return false;
  }

  const { data, error } = await serviceClient.storage.getBucket(normalizedBucket);
  const isPublic = !error && Boolean(data?.public);
  bucketPublicCache.set(normalizedBucket, {
    isPublic,
    expiresAt: Date.now() + BUCKET_PUBLIC_CACHE_TTL_MS,
  });
  return isPublic;
}

async function getSignedImageUrlsForPrivateBucket(
  bucket: string,
  storagePaths: string[]
): Promise<Record<string, string | null>> {
  const urlsByPath: Record<string, string | null> = {};
  if (storagePaths.length === 0) {
    return urlsByPath;
  }

  const serviceClient = getServiceStorageClient();
  if (!serviceClient) {
    for (const path of storagePaths) {
      urlsByPath[path] = getPublicImageUrl(bucket, path);
    }
    return urlsByPath;
  }

  const missingPaths: string[] = [];
  for (const path of storagePaths) {
    const cached = getCachedSignedUrl(bucket, path);
    if (cached) {
      urlsByPath[path] = cached;
      continue;
    }
    missingPaths.push(path);
  }

  if (missingPaths.length > 0) {
    const { data, error } = await serviceClient.storage
      .from(bucket)
      .createSignedUrls(missingPaths, SIGNED_URL_TTL_SECONDS);

    if (error || !Array.isArray(data)) {
      for (const path of missingPaths) {
        urlsByPath[path] = getPublicImageUrl(bucket, path);
      }
      return urlsByPath;
    }

    for (const path of missingPaths) {
      urlsByPath[path] = null;
    }

    for (const entry of data) {
      const path = typeof entry?.path === "string" ? entry.path : null;
      const signedUrl =
        typeof entry?.signedUrl === "string" ? entry.signedUrl : null;

      if (!path || !signedUrl) {
        continue;
      }

      const resolved = toAbsoluteUrl(signedUrl);
      setCachedSignedUrl(bucket, path, resolved);
      urlsByPath[path] = resolved;
    }
  }

  for (const path of storagePaths) {
    if (typeof urlsByPath[path] !== "string") {
      urlsByPath[path] = getCachedSignedUrl(bucket, path) ?? null;
    }
  }

  return urlsByPath;
}

export async function getPublicImageUrlsForAnon(
  inputs: PublicImageUrlInput[]
): Promise<Array<string | null>> {
  if (inputs.length === 0) {
    return [];
  }

  const resolved: Array<string | null> = new Array(inputs.length).fill(null);
  const groupedPaths = new Map<string, string[]>();
  const groupedIndices = new Map<string, Array<{ index: number; path: string }>>();

  for (const [index, input] of inputs.entries()) {
    const normalizedPath = normalizeStoragePath(input.storagePath);
    if (!normalizedPath) {
      continue;
    }
    if (isAbsoluteUrl(normalizedPath)) {
      resolved[index] = normalizedPath;
      continue;
    }

    const bucket = normalizeBucketName(input.bucket);
    if (!groupedPaths.has(bucket)) {
      groupedPaths.set(bucket, []);
    }
    if (!groupedIndices.has(bucket)) {
      groupedIndices.set(bucket, []);
    }

    const bucketPaths = groupedPaths.get(bucket);
    if (bucketPaths && !bucketPaths.includes(normalizedPath)) {
      bucketPaths.push(normalizedPath);
    }
    groupedIndices.get(bucket)?.push({ index, path: normalizedPath });
  }

  for (const [bucket, paths] of groupedPaths.entries()) {
    const bucketIsPublic = await isBucketPublic(bucket);
    let urlsByPath: Record<string, string | null>;

    if (bucketIsPublic) {
      urlsByPath = {};
      for (const path of paths) {
        urlsByPath[path] = getPublicImageUrl(bucket, path);
      }
    } else {
      urlsByPath = await getSignedImageUrlsForPrivateBucket(bucket, paths);
    }

    const references = groupedIndices.get(bucket) ?? [];
    for (const reference of references) {
      resolved[reference.index] = urlsByPath[reference.path] ?? null;
    }
  }

  return resolved;
}

export async function getPublicImageUrlForAnon(
  bucket: string = BUCKET_NAME,
  storagePath: string | null | undefined
): Promise<string | null> {
  const [resolved] = await getPublicImageUrlsForAnon([{ bucket, storagePath }]);
  return resolved ?? null;
}

export function resolvePublicImageUrl(
  storagePath: string | null | undefined,
  bucket: string = BUCKET_NAME
): string | null {
  return getPublicImageUrl(bucket, storagePath);
}
