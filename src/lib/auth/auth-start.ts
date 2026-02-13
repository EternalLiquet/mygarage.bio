import "server-only";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { toSafeNextPath } from "@/lib/auth/safe-next-path";

const AUTH_START_COOKIE_NAME = "auth_start_id";
const AUTH_START_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function isValidAuthStartIdentifier(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 16 && normalized.length <= 128;
}

export function getOrCreateAuthStartIdentifier(): {
  identifier: string;
  shouldSetCookie: boolean;
} {
  const cookieStore = cookies();
  const existing = cookieStore.get(AUTH_START_COOKIE_NAME)?.value ?? "";
  if (isValidAuthStartIdentifier(existing)) {
    return { identifier: existing, shouldSetCookie: false };
  }

  return { identifier: randomUUID(), shouldSetCookie: true };
}

export function applyAuthStartIdentifierCookie(
  response: NextResponse,
  identifier: string,
  shouldSetCookie: boolean
) {
  if (!shouldSetCookie) {
    return;
  }

  response.cookies.set({
    name: AUTH_START_COOKIE_NAME,
    value: identifier,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_START_COOKIE_MAX_AGE_SECONDS,
  });
}

export { toSafeNextPath };

export function buildAuthCallbackUrl(requestUrl: string, nextPath: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
}

export function normalizeLoginEmail(input: string | null | undefined): string | null {
  const value = input?.trim().toLowerCase() ?? "";
  if (!value) {
    return null;
  }

  // Basic guard only; Supabase still performs canonical validation.
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_PATTERN.test(value)) {
    return null;
  }

  return value;
}
