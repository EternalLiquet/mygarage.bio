import Link from "next/link";
import { LimitPaywallModal } from "@/components/dashboard/LimitPaywallModal";
import { ensureProfileExists } from "@/lib/auth/ensure-profile";
import { getDashboardUserIdOrRedirect } from "@/lib/auth/dashboard-request";
import { FREE_TIER_LIMITS } from "@/lib/limits";
import { createServerClient } from "@/lib/supabase/server";

type DashboardPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(
  searchParams: DashboardPageProps["searchParams"],
  key: string
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const supabase = createServerClient();
  const userId = getDashboardUserIdOrRedirect("/dashboard");

  const [profile, { data: vehicles, error: vehiclesError }] = await Promise.all([
    ensureProfileExists(supabase, userId),
    supabase
      .from("vehicles")
      .select("id, name, is_public, sort_order")
      .eq("profile_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (vehiclesError) {
    throw new Error(`Failed to load vehicles: ${vehiclesError.message}`);
  }

  const vehicleIds = (vehicles ?? []).map((vehicle) => vehicle.id);
  const [{ count: imageCount, error: imageCountError }, { data: mods, error: modsError }] =
    await Promise.all([
      supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", userId),
      vehicleIds.length > 0
        ? supabase.from("mods").select("id, vehicle_id").in("vehicle_id", vehicleIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (imageCountError) {
    throw new Error(`Failed to count images: ${imageCountError.message}`);
  }
  if (modsError) {
    throw new Error(`Failed to count mods: ${modsError.message}`);
  }

  const modCounts: Record<string, number> = {};
  for (const vehicleId of vehicleIds) {
    modCounts[vehicleId] = 0;
  }
  for (const mod of mods ?? []) {
    modCounts[mod.vehicle_id] = (modCounts[mod.vehicle_id] ?? 0) + 1;
  }

  const status = getParam(searchParams, "status");
  const error = getParam(searchParams, "error");
  const limit = getParam(searchParams, "limit");
  const isPro = profile.is_pro;
  const vehicleCount = vehicles?.length ?? 0;
  const totalImages = imageCount ?? 0;
  const atVehicleLimit = !isPro && vehicleCount >= FREE_TIER_LIMITS.vehicles;
  const hasPublicUsername = Boolean(profile.username);
  const publicProfileHref = hasPublicUsername
    ? `/u/${profile.username}`
    : "/dashboard/profile";

  return (
    <main className="dashboard-page">
      <section className="dashboard-heading-row">
        <div>
          <h1 className="dashboard-title">Garage Dashboard</h1>
          <p className="dashboard-subtitle">
            Manage your public profile and your builds.
          </p>
        </div>
        <div className="dashboard-top-links">
          <Link className="auth-link" href="/dashboard/profile">
            Edit profile
          </Link>
          <Link className="auth-link" href={publicProfileHref}>
            {hasPublicUsername ? "View public page" : "Choose username"}
          </Link>
        </div>
      </section>

      {status ? <p className="status-message">{status}</p> : null}
      {error ? <p className="error-message">{error}</p> : null}

      <section className="dashboard-card">
        <h2 className="dashboard-section-title">Plan & Limits</h2>
        <p>
          <strong>Plan:</strong> {isPro ? "Pro" : "Free"}
        </p>
        <p>
          <strong>Vehicles:</strong> {vehicleCount}
          {!isPro ? ` / ${FREE_TIER_LIMITS.vehicles}` : ""}
        </p>
        <p>
          <strong>Images:</strong> {totalImages}
          {!isPro ? ` / ${FREE_TIER_LIMITS.imagesPerProfile}` : ""}
        </p>
        {!isPro ? (
          <p>
            <strong>Mods per vehicle:</strong> {FREE_TIER_LIMITS.modsPerVehicle}
          </p>
        ) : null}

        {limit ? (
          <LimitPaywallModal
            title="Free plan limit reached"
            description="Upgrade to Pro to publish more builds, mods, and photos."
          />
        ) : null}
      </section>

      <section className="dashboard-card">
        <div className="dashboard-list-header">
          <h2 className="dashboard-section-title">Vehicles</h2>
          {atVehicleLimit ? (
            <span className="dashboard-badge">Free limit reached</span>
          ) : (
            <Link className="primary-link" href="/dashboard/vehicles/new">
              Add vehicle
            </Link>
          )}
        </div>

        {(vehicles?.length ?? 0) === 0 ? (
          <p className="empty-state">No vehicles yet. Add your first build.</p>
        ) : (
          <ul className="dashboard-list">
            {vehicles?.map((vehicle) => (
              <li className="dashboard-list-item" key={vehicle.id}>
                <div>
                  <p className="dashboard-item-title">{vehicle.name}</p>
                  <p className="dashboard-item-subtitle">
                    {vehicle.is_public ? "Public" : "Private"} · {modCounts[vehicle.id] ?? 0} mods
                  </p>
                </div>
                <div className="dashboard-item-actions">
                  <Link className="auth-link" href={`/dashboard/vehicles/${vehicle.id}/edit`}>
                    Edit
                  </Link>
                  {vehicle.is_public && profile.username ? (
                    <Link className="auth-link" href={`/u/${profile.username}/v/${vehicle.id}`}>
                      View
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
