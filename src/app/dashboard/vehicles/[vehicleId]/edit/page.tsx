/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createModAction,
  deleteImageAction,
  deleteModAction,
  deleteVehicleAction,
  moveModAction,
  moveVehicleAction,
  updateVehicleAction,
  uploadImageAction,
} from "@/app/dashboard/actions";
import { ImageUploader } from "@/components/dashboard/ImageUploader";
import { LimitPaywallModal } from "@/components/dashboard/LimitPaywallModal";
import { ModForm } from "@/components/dashboard/ModForm";
import { VehicleForm } from "@/components/dashboard/VehicleForm";
import { ensureProfileExists } from "@/lib/auth/ensure-profile";
import { getDashboardUserIdOrRedirect } from "@/lib/auth/dashboard-request";
import { FREE_TIER_LIMITS } from "@/lib/limits";
import { getPublicImageUrlsForAnon } from "@/lib/media";
import { createServerClient } from "@/lib/supabase/server";

type VehicleEditPageProps = {
  params: {
    vehicleId: string;
  };
  searchParams?: Record<string, string | string[] | undefined>;
};

type DashboardImage = {
  id: string;
  caption: string | null;
  storage_bucket: string;
  storage_path: string;
  mod_id: string | null;
  vehicle_id: string | null;
  sort_order: number;
};

type VehicleModSummary = {
  id: string;
  title: string;
  category: string | null;
  cost_cents: number | null;
  installed_on: string | null;
  sort_order: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function getParam(
  searchParams: VehicleEditPageProps["searchParams"],
  key: string
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function formatInstalledOn(installedOn: string | null): string | null {
  if (!installedOn) {
    return null;
  }

  const date = new Date(installedOn);
  if (Number.isNaN(date.valueOf())) {
    return installedOn;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatModSummary(mod: Pick<VehicleModSummary, "category" | "cost_cents" | "installed_on">): string {
  const parts: string[] = [];

  if (mod.category) {
    parts.push(mod.category);
  }
  if (typeof mod.cost_cents === "number") {
    parts.push(USD_FORMATTER.format(mod.cost_cents / 100));
  }

  const installedOn = formatInstalledOn(mod.installed_on);
  if (installedOn) {
    parts.push(`Installed ${installedOn}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "No extra details yet.";
}

export default async function VehicleEditPage({
  params,
  searchParams,
}: VehicleEditPageProps) {
  if (!isUuid(params.vehicleId)) {
    notFound();
  }

  const supabase = createServerClient();
  const userId = getDashboardUserIdOrRedirect(`/dashboard/vehicles/${params.vehicleId}/edit`);

  const [profile, { data: vehicle, error: vehicleError }] = await Promise.all([
    ensureProfileExists(supabase, userId),
    supabase
      .from("vehicles")
      .select("id, name, year, make, model, trim, hero_image_path, is_public, sort_order")
      .eq("id", params.vehicleId)
      .eq("profile_id", userId)
      .maybeSingle(),
  ]);

  if (vehicleError) {
    throw new Error(`Failed to load vehicle: ${vehicleError.message}`);
  }
  if (!vehicle) {
    notFound();
  }

  const [
    { data: allVehicles, error: allVehiclesError },
    { data: mods, error: modsError },
    { data: vehicleImages, error: vehicleImagesError },
    { count: totalImageCount, error: imageCountError },
  ] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id")
      .eq("profile_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("mods")
      .select("id, title, category, cost_cents, installed_on, sort_order")
      .eq("vehicle_id", params.vehicleId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("images")
      .select("id, caption, storage_bucket, storage_path, mod_id, vehicle_id, sort_order")
      .eq("vehicle_id", params.vehicleId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", userId),
  ]);

  if (allVehiclesError) {
    throw new Error(`Failed to load vehicles list: ${allVehiclesError.message}`);
  }
  if (modsError) {
    throw new Error(`Failed to load mods: ${modsError.message}`);
  }
  if (vehicleImagesError) {
    throw new Error(`Failed to load vehicle images: ${vehicleImagesError.message}`);
  }
  if (imageCountError) {
    throw new Error(`Failed to count images: ${imageCountError.message}`);
  }

  const resolvedVehicleImageUrls = await getPublicImageUrlsForAnon(
    (vehicleImages ?? []).map((image) => ({
      bucket: image.storage_bucket,
      storagePath: image.storage_path,
    }))
  );

  const vehicleImageUrlsById: Record<string, string | null> = {};
  for (const [index, image] of (vehicleImages ?? []).entries()) {
    vehicleImageUrlsById[image.id] = resolvedVehicleImageUrls[index] ?? null;
  }

  const status = getParam(searchParams, "status");
  const error = getParam(searchParams, "error");
  const limit = getParam(searchParams, "limit");
  const section = getParam(searchParams, "section");
  const redirectTo = `/dashboard/vehicles/${params.vehicleId}/edit`;
  const vehicleImagesRedirectTo = `${redirectTo}?section=vehicle-images#vehicle-images`;

  const vehicleOrder = allVehicles ?? [];
  const vehicleIndex = vehicleOrder.findIndex((entry) => entry.id === params.vehicleId);
  const canMoveVehicleUp = vehicleIndex > 0;
  const canMoveVehicleDown =
    vehicleIndex >= 0 && vehicleIndex < Math.max(vehicleOrder.length - 1, 0);

  const isPro = profile.is_pro;
  const modRows = (mods ?? []) as VehicleModSummary[];
  const modLimitReached = !isPro && modRows.length >= FREE_TIER_LIMITS.modsPerVehicle;
  const imageLimitReached = !isPro && (totalImageCount ?? 0) >= FREE_TIER_LIMITS.imagesPerProfile;

  return (
    <main className="dashboard-page">
      <p className="back-link-row">
        <Link className="back-link" href="/dashboard">
          Back to dashboard
        </Link>
      </p>

      <section className="dashboard-heading-row">
        <div>
          <h1 className="dashboard-title">Edit Vehicle</h1>
          <p className="dashboard-subtitle">{vehicle.name}</p>
        </div>
        {profile.username ? (
          <Link className="auth-link" href={`/u/${profile.username}/v/${vehicle.id}`}>
            View public page
          </Link>
        ) : null}
      </section>

      {section !== "vehicle-images" && status ? (
        <p className="status-message">{status}</p>
      ) : null}
      {section !== "vehicle-images" && error ? (
        <p className="error-message">{error}</p>
      ) : null}

      <section className="dashboard-card">
        <h2 className="dashboard-section-title">Vehicle Details</h2>
        <VehicleForm
          action={updateVehicleAction}
          mode="edit"
          redirectTo={redirectTo}
          submitLabel="Save vehicle"
          vehicle={vehicle}
        />

        <div className="dashboard-inline-actions">
          <form action={moveVehicleAction}>
            <input name="redirect_to" type="hidden" value={redirectTo} />
            <input name="vehicle_id" type="hidden" value={vehicle.id} />
            <input name="direction" type="hidden" value="up" />
            <button className="secondary-button" type="submit" disabled={!canMoveVehicleUp}>
              Move vehicle up
            </button>
          </form>
          <form action={moveVehicleAction}>
            <input name="redirect_to" type="hidden" value={redirectTo} />
            <input name="vehicle_id" type="hidden" value={vehicle.id} />
            <input name="direction" type="hidden" value="down" />
            <button className="secondary-button" type="submit" disabled={!canMoveVehicleDown}>
              Move vehicle down
            </button>
          </form>
          <form action={deleteVehicleAction}>
            <input name="vehicle_id" type="hidden" value={vehicle.id} />
            <button className="danger-button" type="submit">
              Delete vehicle
            </button>
          </form>
        </div>
      </section>

      <section className="dashboard-card" id="vehicle-images">
        <h2 className="dashboard-section-title">Vehicle Images</h2>
        {section === "vehicle-images" && status ? (
          <p className="status-message">{status}</p>
        ) : null}
        {section === "vehicle-images" && error ? (
          <p className="error-message">{error}</p>
        ) : null}
        {limit === "images" || imageLimitReached ? (
          <LimitPaywallModal
            title="Image limit reached"
            description={`Free includes ${FREE_TIER_LIMITS.imagesPerProfile} total images.`}
          />
        ) : null}

        <ImageUploader
          action={uploadImageAction}
          parentType="vehicle"
          parentId={vehicle.id}
          vehicleId={vehicle.id}
          redirectTo={vehicleImagesRedirectTo}
          buttonLabel="Upload vehicle image"
          disabled={imageLimitReached}
        />

        {(vehicleImages?.length ?? 0) === 0 ? (
          <p className="empty-state">No vehicle images yet.</p>
        ) : (
          <div className="dashboard-image-grid">
            {vehicleImages?.map((image) => {
              const url = vehicleImageUrlsById[image.id] ?? null;
              if (!url) {
                return null;
              }

              return (
                <article className="dashboard-image-card" key={image.id}>
                  <img className="dashboard-image" src={url} alt={image.caption ?? "Vehicle image"} />
                  <div className="dashboard-image-actions">
                    {image.caption ? (
                      <p className="dashboard-image-caption">{image.caption}</p>
                    ) : null}
                    <form action={deleteImageAction}>
                      <input name="redirect_to" type="hidden" value={vehicleImagesRedirectTo} />
                      <input name="vehicle_id" type="hidden" value={vehicle.id} />
                      <input name="image_id" type="hidden" value={image.id} />
                      <button className="danger-button danger-button-small" type="submit">
                        Delete
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="dashboard-card">
        <div className="dashboard-list-header">
          <h2 className="dashboard-section-title">Mods</h2>
          <span className="section-count">{modRows.length}</span>
        </div>

        {limit === "mods" || modLimitReached ? (
          <LimitPaywallModal
            title="Mod limit reached"
            description={`Free includes ${FREE_TIER_LIMITS.modsPerVehicle} mods per vehicle.`}
          />
        ) : null}

        <h3 className="dashboard-subsection-title">Add Mod</h3>
        <p className="dashboard-item-subtitle">
          Create a new mod here. Edit existing mods on their own detail page.
        </p>
        <ModForm
          action={createModAction}
          vehicleId={vehicle.id}
          redirectTo={redirectTo}
          submitLabel="Create mod"
          disabled={modLimitReached}
        />

        <div className="dashboard-divider" />

        <h3 className="dashboard-subsection-title">Current Mods</h3>
        {modRows.length === 0 ? (
          <p className="empty-state">No mods yet.</p>
        ) : (
          <ul className="dashboard-list">
            {modRows.map((mod, index) => (
              <li className="dashboard-list-item" key={mod.id}>
                <div>
                  <p className="dashboard-item-title">{mod.title}</p>
                  <p className="dashboard-item-subtitle">{formatModSummary(mod)}</p>
                </div>
                <div className="dashboard-item-actions">
                  <Link
                    className="auth-link"
                    href={`/dashboard/vehicles/${vehicle.id}/mods/${mod.id}/edit`}
                  >
                    Edit details
                  </Link>
                  <form action={moveModAction}>
                    <input name="redirect_to" type="hidden" value={redirectTo} />
                    <input name="vehicle_id" type="hidden" value={vehicle.id} />
                    <input name="mod_id" type="hidden" value={mod.id} />
                    <input name="direction" type="hidden" value="up" />
                    <button className="secondary-button" type="submit" disabled={index === 0}>
                      Move up
                    </button>
                  </form>
                  <form action={moveModAction}>
                    <input name="redirect_to" type="hidden" value={redirectTo} />
                    <input name="vehicle_id" type="hidden" value={vehicle.id} />
                    <input name="mod_id" type="hidden" value={mod.id} />
                    <input name="direction" type="hidden" value="down" />
                    <button
                      className="secondary-button"
                      type="submit"
                      disabled={index === modRows.length - 1}
                    >
                      Move down
                    </button>
                  </form>
                  <form action={deleteModAction}>
                    <input name="redirect_to" type="hidden" value={redirectTo} />
                    <input name="vehicle_id" type="hidden" value={vehicle.id} />
                    <input name="mod_id" type="hidden" value={mod.id} />
                    <button className="danger-button" type="submit">
                      Delete mod
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
