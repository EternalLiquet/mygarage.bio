import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_USER_ID_HEADER } from "@/lib/auth/dashboard-header";
import { toSafeNextPath } from "@/lib/auth/safe-next-path";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toLoginRedirectPath(nextPath: string): string {
  const safeNext = toSafeNextPath(nextPath);
  return `/login?next=${encodeURIComponent(safeNext)}`;
}

export function getDashboardUserIdOrRedirect(nextPath: string): string {
  // Middleware is the primary dashboard access gate. It injects this header only
  // after verifying the session once for the request.
  const userId = headers().get(DASHBOARD_USER_ID_HEADER)?.trim() ?? "";
  if (!UUID_PATTERN.test(userId)) {
    redirect(toLoginRedirectPath(nextPath));
  }
  return userId;
}

