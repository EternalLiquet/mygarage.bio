import { NextResponse } from "next/server";
import {
  createServerClient as createSupabaseServerClient,
  type CookieOptions,
} from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  applyAuthStartIdentifierCookie,
  buildAuthCallbackUrl,
  getOrCreateAuthStartIdentifier,
  toSafeNextPath,
} from "@/lib/auth/auth-start";
import {
  enforceDurableRateLimit,
  getRequestIpAddress,
  RateLimitExceededError,
} from "@/lib/security/rate-limit";

function getSupabaseEnv() {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase auth environment.");
  }

  return { supabaseUrl, supabaseAnonKey };
}

const OAUTH_RATE_LIMITS = {
  ip: { maxRequests: 12, windowMs: 60_000 },
  identifier: { maxRequests: 30, windowMs: 10 * 60_000 },
} as const;

type OAuthProvider = "google";

type OAuthStartRequestBody = {
  provider?: string;
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

function toProvider(value: string | undefined): OAuthProvider | null {
  return value === "google" ? "google" : null;
}

export async function POST(request: Request) {
  let body: OAuthStartRequestBody;
  try {
    body = (await request.json()) as OAuthStartRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const provider = toProvider(body.provider);
  if (!provider) {
    return NextResponse.json(
      { error: "Unsupported sign-in provider." },
      { status: 400 },
    );
  }

  const nextPath = toSafeNextPath(
    typeof body.next === "string" ? body.next : null,
  );
  const authStartIdentifier = getOrCreateAuthStartIdentifier();

  try {
    await enforceDurableRateLimit({
      action: "auth-start-oauth",
      targets: [
        {
          scope: "ip",
          identifier: getRequestIpAddress(),
          rule: OAUTH_RATE_LIMITS.ip,
        },
        {
          scope: "identifier",
          identifier: authStartIdentifier.identifier,
          rule: OAUTH_RATE_LIMITS.identifier,
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
        event: "auth_start_oauth_unavailable",
        errorName: error.name,
        errorMessage: error.message,
      });
    } else {
      console.error({
        event: "auth_start_oauth_unavailable",
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

  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
  const pendingCookies: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];
  const cookieStore = cookies();
  const supabase = createSupabaseServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  const redirectTo = buildAuthCallbackUrl(request.url, nextPath);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
    },
  });

  if (error || !data?.url) {
    return withAuthStartCookie(
      NextResponse.json(
        { error: "Could not start Google sign-in. Please try again." },
        { status: 400 },
      ),
      authStartIdentifier,
    );
  }

  const response = withAuthStartCookie(
    NextResponse.json({ url: data.url }),
    authStartIdentifier,
  );

  for (const cookie of pendingCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }

  return response;
}
