import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import {
  createServerClient as createSupabaseServerClient,
  type CookieOptions,
} from "@supabase/ssr";
import { cookies } from "next/headers";
import { toSafeNextPath } from "@/lib/auth/safe-next-path";

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

const EMAIL_OTP_TYPES: ReadonlySet<EmailOtpType> = new Set([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function toEmailOtpType(value: string | null): EmailOtpType | null {
  if (!value) {
    return null;
  }

  return EMAIL_OTP_TYPES.has(value as EmailOtpType)
    ? (value as EmailOtpType)
    : null;
}

async function completeAuthFromCallback(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  requestUrl: URL,
) {
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = toEmailOtpType(requestUrl.searchParams.get("type"));

  if (code) {
    const exchangeResult = await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeResult.error) {
      return exchangeResult;
    }

    if (tokenHash && otpType) {
      const otpResult = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });
      if (!otpResult.error) {
        return otpResult;
      }
    }

    return exchangeResult;
  }

  if (tokenHash && otpType) {
    return supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
  }

  return supabase.auth.exchangeCodeForSession(requestUrl.toString());
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const nextPath = toSafeNextPath(requestUrl.searchParams.get("next"));
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

  const { error: callbackError } = await completeAuthFromCallback(
    supabase,
    requestUrl,
  );
  if (callbackError) {
    const hasCode = Boolean(requestUrl.searchParams.get("code"));
    const hasTokenHash = Boolean(requestUrl.searchParams.get("token_hash"));
    const stage = hasCode
      ? "exchange"
      : hasTokenHash
        ? "verify_otp"
        : "unknown";

    console.error({
      event: "auth_callback_failed",
      stage,
      errorName: callbackError.name,
      errorMessage: callbackError.message,
      urlPath: requestUrl.pathname,
      queryKeys: Array.from(requestUrl.searchParams.keys()),
    });

    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set("error", "auth_callback_failed");

    // Helpful for local debugging; avoid leaking provider details in production.
    if (process.env.NODE_ENV !== "production") {
      loginUrl.searchParams.set("stage", stage);
      loginUrl.searchParams.set("detail", callbackError.message.slice(0, 140));
    }

    const response = NextResponse.redirect(loginUrl);
    for (const cookie of pendingCookies) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return response;
  }

  const response = NextResponse.redirect(new URL(nextPath, requestUrl.origin));
  for (const cookie of pendingCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}
