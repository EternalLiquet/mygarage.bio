"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { toSafeNextPath } from "@/lib/auth/safe-next-path";

type ApiResponse = {
  status?: string;
  error?: string;
  url?: string;
};

async function parseApiResponse(response: Response): Promise<ApiResponse> {
  try {
    return (await response.json()) as ApiResponse;
  } catch {
    return {};
  }
}

export function LoginClient() {
  const searchParams = useSearchParams();
  const nextPath = toSafeNextPath(searchParams.get("next"));

  const callbackError = searchParams.get("error");
  const stage = searchParams.get("stage");
  const detail = searchParams.get("detail");

  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    callbackError ? "Sign-in failed. Please try again." : null,
  );
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  async function handleEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage("Enter an email address.");
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    setIsEmailLoading(true);

    try {
      const response = await fetch("/auth/start/otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: trimmedEmail,
          next: nextPath,
        }),
      });
      const payload = await parseApiResponse(response);

      if (!response.ok) {
        setErrorMessage(payload.error ?? "Sign-in failed. Please try again.");
      } else {
        setStatusMessage(
          payload.status ?? "Check your email for a sign-in link.",
        );
      }
    } catch {
      setErrorMessage("Sign-in failed. Please try again.");
    }

    setIsEmailLoading(false);
  }

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsGoogleLoading(true);

    try {
      const response = await fetch("/auth/start/oauth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "google",
          next: nextPath,
        }),
      });
      const payload = await parseApiResponse(response);

      if (!response.ok || !payload.url) {
        setErrorMessage(payload.error ?? "Sign-in failed. Please try again.");
        setIsGoogleLoading(false);
        return;
      }

      window.location.assign(payload.url);
    } catch {
      setErrorMessage("Sign-in failed. Please try again.");
      setIsGoogleLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-subtitle">Use email magic link or Google.</p>

      <form className="auth-form" onSubmit={handleEmailSignIn}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />
        <button
          className="primary-button"
          disabled={isEmailLoading}
          type="submit"
        >
          {isEmailLoading ? "Sending..." : "Send magic link"}
        </button>
      </form>

      <button
        className="secondary-button"
        disabled={isGoogleLoading}
        onClick={handleGoogleSignIn}
        type="button"
      >
        {isGoogleLoading ? "Redirecting..." : "Continue with Google"}
      </button>

      {statusMessage ? <p className="status-message">{statusMessage}</p> : null}
      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      {callbackError && process.env.NODE_ENV !== "production" ? (
        <p className="error-message">
          Debug: {stage ?? "unknown"}
          {detail ? ` · ${detail}` : ""}
        </p>
      ) : null}
    </main>
  );
}
