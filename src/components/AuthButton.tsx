"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

type AuthState = "unknown" | "authenticated" | "anonymous";

export function AuthButton() {
  const [authState, setAuthState] = useState<AuthState>("unknown");

  useEffect(() => {
    const supabase = createBrowserClient();
    let active = true;

    async function resolveAuthState() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      setAuthState(session?.user ? "authenticated" : "anonymous");
    }

    void resolveAuthState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }

      setAuthState(session?.user ? "authenticated" : "anonymous");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (authState !== "authenticated") {
    return (
      <Link className="auth-link" href="/login">
        Sign in
      </Link>
    );
  }

  return (
    <div className="auth-actions">
      <Link className="auth-link" href="/dashboard">
        Dashboard
      </Link>
      <form action="/logout" method="post">
        <button className="auth-button" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
}
