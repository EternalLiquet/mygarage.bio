import "server-only";

import { createHash } from "crypto";
import { headers } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type RateLimitRule = {
  maxRequests: number;
  windowMs: number;
};

type EnforceServerActionRateLimitOptions = {
  action: string;
  userId: string;
  userLimit: RateLimitRule;
  ipLimit: RateLimitRule;
  ipAddress?: string;
};

type DurableRateLimitTarget = {
  scope: string;
  identifier: string;
  rule: RateLimitRule;
  hashIdentifier?: boolean;
};

type EnforceDurableRateLimitOptions = {
  action: string;
  targets: DurableRateLimitTarget[];
};

type ConsumeResultRow = {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  window_ends_at: string;
};

type ConsumeResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

let serviceRoleClient: SupabaseClient | null = null;

function getSupabaseServiceClient(): SupabaseClient {
  if (serviceRoleClient) {
    return serviceRoleClient;
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.");
  }

  serviceRoleClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return serviceRoleClient;
}

function normalizeRule(rule: RateLimitRule): {
  maxRequests: number;
  windowSeconds: number;
} {
  const maxRequests = Math.max(1, Math.floor(rule.maxRequests || 0));
  const windowMs = Math.max(1_000, Math.floor(rule.windowMs || 0));
  return {
    maxRequests,
    windowSeconds: Math.max(1, Math.floor(windowMs / 1000)),
  };
}

function normalizeKeyPart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:._-]/g, "_");
  return normalized.length > 0 ? normalized.slice(0, 160) : fallback;
}

function toHashedKeyPart(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  return createHash("sha256").update(normalized).digest("hex").slice(0, 48);
}

function asConsumeRow(data: unknown): ConsumeResultRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return null;
  }

  const candidate = row as Partial<ConsumeResultRow>;
  if (typeof candidate.allowed !== "boolean") {
    return null;
  }

  return {
    allowed: candidate.allowed,
    remaining: Number(candidate.remaining ?? 0),
    retry_after_seconds: Number(candidate.retry_after_seconds ?? 0),
    window_ends_at: String(candidate.window_ends_at ?? ""),
  };
}

async function consumeBucket(
  bucketKey: string,
  rule: RateLimitRule,
): Promise<ConsumeResult> {
  const client = getSupabaseServiceClient();
  const normalizedRule = normalizeRule(rule);

  const { data, error } = await client.rpc("rate_limit_consume", {
    p_bucket_key: bucketKey,
    p_max_requests: normalizedRule.maxRequests,
    p_window_seconds: normalizedRule.windowSeconds,
  });

  if (error) {
    const baseMessage = "Rate-limit backend unavailable.";
    if (process.env.NODE_ENV !== "production") {
      // Helpful in local/dev to distinguish:
      // - missing SQL migration/function
      // - wrong SUPABASE_SERVICE_ROLE_KEY (not actually service_role)
      // - permission errors on function/table
      // - network/URL mismatch
      const detail = error.message ? ` ${error.message}` : "";
      throw new Error(`${baseMessage}${detail}`.trim());
    }

    throw new Error(baseMessage);
  }

  const row = asConsumeRow(data);
  if (!row) {
    throw new Error("Invalid rate-limit backend response.");
  }

  const retryAfterSeconds = Number.isFinite(row.retry_after_seconds)
    ? Math.max(0, Math.floor(row.retry_after_seconds))
    : 0;

  return {
    allowed: row.allowed,
    retryAfterSeconds,
  };
}

export function getRequestIpAddress(): string {
  const headerStore = headers();

  const forwardedFor = headerStore.get("x-forwarded-for");
  if (forwardedFor) {
    const ip = forwardedFor.split(",")[0]?.trim();
    if (ip) {
      return ip;
    }
  }

  const fallback =
    headerStore.get("x-real-ip") ??
    headerStore.get("cf-connecting-ip") ??
    headerStore.get("x-vercel-forwarded-for");
  return fallback?.trim() || "unknown";
}

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many requests.");
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = Math.max(1, Math.floor(retryAfterSeconds));
  }
}

export async function enforceDurableRateLimit(
  options: EnforceDurableRateLimitOptions,
): Promise<void> {
  const action = normalizeKeyPart(options.action, "action");
  const targets = options.targets
    .map((target) => ({
      scope: normalizeKeyPart(target.scope, "scope"),
      identifier: target.hashIdentifier
        ? toHashedKeyPart(target.identifier)
        : normalizeKeyPart(target.identifier, "unknown"),
      rule: target.rule,
    }))
    .filter((target) => target.identifier.length > 0);

  if (targets.length === 0) {
    return;
  }

  const results = await Promise.all(
    targets.map((target) =>
      consumeBucket(
        `rl:${action}:${target.scope}:${target.identifier}`,
        target.rule,
      ),
    ),
  );

  const blocked = results.filter((result) => !result.allowed);
  if (blocked.length === 0) {
    return;
  }

  const retryAfterSeconds = blocked.reduce((maxSeconds, result) => {
    return Math.max(maxSeconds, result.retryAfterSeconds);
  }, 1);

  throw new RateLimitExceededError(retryAfterSeconds);
}

export async function enforceServerActionRateLimit(
  options: EnforceServerActionRateLimitOptions,
): Promise<void> {
  const ipAddress = options.ipAddress?.trim() || getRequestIpAddress();

  await enforceDurableRateLimit({
    action: options.action,
    targets: [
      {
        scope: "user",
        identifier: options.userId,
        rule: options.userLimit,
      },
      {
        scope: "ip",
        identifier: ipAddress,
        rule: options.ipLimit,
      },
    ],
  });
}
