import { NextResponse } from "next/server";
import {
  applyAuthStartIdentifierCookie,
  buildAuthCallbackUrl,
  getOrCreateAuthStartIdentifier,
  normalizeLoginEmail,
  toSafeNextPath,
} from "@/lib/auth/auth-start";
import {
  enforceDurableRateLimit,
  getRequestIpAddress,
  RateLimitExceededError,
} from "@/lib/security/rate-limit";
import { createServerClient } from "@/lib/supabase/server";

const OTP_RATE_LIMITS = {
  ip: { maxRequests: 8, windowMs: 60_000 },
  identifier: { maxRequests: 20, windowMs: 10 * 60_000 },
  email: { maxRequests: 5, windowMs: 10 * 60_000 },
} as const;

type OtpStartRequestBody = {
  email?: string;
  next?: string;
};

function withAuthStartCookie(
  response: NextResponse,
  authStartIdentifier: { identifier: string; shouldSetCookie: boolean },
): NextResponse {
  applyAuthStartIdentifierCookie(
    response,
    authStartIdentifier.identifier,
    authStartIdentifier.shouldSetCookie,
  );
  return response;
}

function toFriendlyRateLimitMessage(retryAfterSeconds: number): string {
  const waitText =
    retryAfterSeconds <= 1 ? "a moment" : `${retryAfterSeconds} seconds`;
  return `Too many sign-in attempts. Please wait ${waitText} and try again.`;
}

export async function POST(request: Request) {
  let body: OtpStartRequestBody;
  try {
    body = (await request.json()) as OtpStartRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const nextPath = toSafeNextPath(
    typeof body.next === "string" ? body.next : null,
  );
  const email = normalizeLoginEmail(body.email);
  if (!email) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const authStartIdentifier = getOrCreateAuthStartIdentifier();

  try {
    await enforceDurableRateLimit({
      action: "auth-start-otp",
      targets: [
        {
          scope: "ip",
          identifier: getRequestIpAddress(),
          rule: OTP_RATE_LIMITS.ip,
        },
        {
          scope: "identifier",
          identifier: authStartIdentifier.identifier,
          rule: OTP_RATE_LIMITS.identifier,
          hashIdentifier: true,
        },
        {
          scope: "email",
          identifier: email,
          rule: OTP_RATE_LIMITS.email,
          hashIdentifier: true,
        },
      ],
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return withAuthStartCookie(
        NextResponse.json(
          { error: toFriendlyRateLimitMessage(error.retryAfterSeconds) },
          { status: 429 },
        ),
        authStartIdentifier,
      );
    }

    if (error instanceof Error) {
      console.error({
        event: "auth_start_otp_unavailable",
        errorName: error.name,
        errorMessage: error.message,
      });
    } else {
      console.error({
        event: "auth_start_otp_unavailable",
        errorValue: String(error),
      });
    }

    return withAuthStartCookie(
      NextResponse.json(
        { error: "Sign-in is temporarily unavailable. Please try again soon." },
        { status: 503 },
      ),
      authStartIdentifier,
    );
  }

  const supabase = createServerClient();
  const redirectTo = buildAuthCallbackUrl(request.url, nextPath);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    return withAuthStartCookie(
      NextResponse.json(
        { error: "Could not send magic link. Please try again." },
        { status: 400 },
      ),
      authStartIdentifier,
    );
  }

  return withAuthStartCookie(
    NextResponse.json({ status: "Check your email for a sign-in link." }),
    authStartIdentifier,
  );
}
