import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import { DASHBOARD_USER_ID_HEADER } from "@/lib/auth/dashboard-header";

export async function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.next({
      request,
    });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(DASHBOARD_USER_ID_HEADER);

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // Middleware is the authoritative gate for /dashboard routes. Downstream
  // server components read this header instead of repeating auth.getUser calls.
  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>
      ) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
        }

        response = NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });

        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  requestHeaders.set(DASHBOARD_USER_ID_HEADER, user.id);
  const finalResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  for (const cookie of response.cookies.getAll()) {
    finalResponse.cookies.set(cookie);
  }

  return finalResponse;
}

export const config = {
  matcher: ["/dashboard/:path*", "/auth/callback", "/logout"],
};
