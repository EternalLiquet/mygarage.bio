import { createVehicleAction } from "@/app/dashboard/actions";
import { LimitPaywallModal } from "@/components/dashboard/LimitPaywallModal";
import { VehicleForm } from "@/components/dashboard/VehicleForm";
import { ensureProfileExists } from "@/lib/auth/ensure-profile";
import { getDashboardUserIdOrRedirect } from "@/lib/auth/dashboard-request";
import { FREE_TIER_LIMITS } from "@/lib/limits";
import { createServerClient } from "@/lib/supabase/server";

type NewVehiclePageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(
  searchParams: NewVehiclePageProps["searchParams"],
  key: string
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default async function NewVehiclePage({ searchParams }: NewVehiclePageProps) {
  const supabase = createServerClient();
  const userId = getDashboardUserIdOrRedirect("/dashboard/vehicles/new");

  const [profile, { count: vehicleCount, error: vehicleCountError }] = await Promise.all([
    ensureProfileExists(supabase, userId),
    supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", userId),
  ]);

  if (vehicleCountError) {
    throw new Error(`Failed to count vehicles: ${vehicleCountError.message}`);
  }

  const status = getParam(searchParams, "status");
  const error = getParam(searchParams, "error");
  const limit = getParam(searchParams, "limit");
  const atLimit = !profile.is_pro && (vehicleCount ?? 0) >= FREE_TIER_LIMITS.vehicles;

  return (
    <main className="dashboard-page">
      <section className="dashboard-heading-row">
        <div>
          <h1 className="dashboard-title">Add Vehicle</h1>
          <p className="dashboard-subtitle">Create a new build card for your public profile.</p>
        </div>
      </section>

      {status ? <p className="status-message">{status}</p> : null}
      {error ? <p className="error-message">{error}</p> : null}

      {limit === "vehicles" || atLimit ? (
        <LimitPaywallModal
          title="Vehicle limit reached on Free plan"
          description={`Free includes ${FREE_TIER_LIMITS.vehicles} vehicle. Upgrade to Pro for unlimited builds.`}
        />
      ) : null}

      <section className="dashboard-card">
        <VehicleForm
          action={createVehicleAction}
          mode="create"
          redirectTo="/dashboard/vehicles/new"
          submitLabel="Create vehicle"
          disabled={atLimit}
        />
      </section>
    </main>
  );
}
