import type { ReactNode } from "react";
import { ensureProfileExists } from "@/lib/auth/ensure-profile";
import { getDashboardUserIdOrRedirect } from "@/lib/auth/dashboard-request";
import { createServerClient } from "@/lib/supabase/server";

type DashboardLayoutProps = {
  children: ReactNode;
};

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const supabase = createServerClient();
  const userId = getDashboardUserIdOrRedirect("/dashboard");

  await ensureProfileExists(supabase, userId);

  return <>{children}</>;
}
