/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteImageAction,
  deleteModAction,
  moveModAction,
  updateModAction,
  uploadImageAction,
} from "@/app/dashboard/actions";
import { ImageUploader } from "@/components/dashboard/ImageUploader";
import { LimitPaywallModal } from "@/components/dashboard/LimitPaywallModal";
import { ModForm } from "@/components/dashboard/ModForm";
import { ensureProfileExists } from "@/lib/auth/ensure-profile";
import { getDashboardUserIdOrRedirect } from "@/lib/auth/dashboard-request";
import { FREE_TIER_LIMITS } from "@/lib/limits";
import { getPublicImageUrlsForAnon } from "@/lib/media";
import { createServerClient } from "@/lib/supabase/server";

type ModEditPageProps = {
  params: {
    vehicleId: string;
    modId: string;
  };
  searchParams?: Record<string, string | string[] | undefined>;
};

type ModImageRow = {
  id: string;
  caption: string | null;
  storage_bucket: string;
  storage_path: string;
  sort_order: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function getParam(
  searchParams: ModEditPageProps["searchParams"],
  key: string
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default async function ModEditPage({ params, searchParams }: ModEditPageProps) {
  if (!isUuid(params.vehicleId) || !isUuid(params.modId)) {
    notFound();
  }

  const supabase = createServerClient();
  const redirectTo = `/dashboard/vehicles/${params.vehicleId}/mods/${params.modId}/edit`;
  const vehicleEditPath = `/dashboard/vehicles/${params.vehicleId}/edit`;
  const userId = getDashboardUserIdOrRedirect(redirectTo);

  const [
    profile,
    { data: vehicle, error: vehicleError },
    { data: mod, error: modError },
  ] = await Promise.all([
    ensureProfileExists(supabase, userId),
    supabase
      .from("vehicles")
      .select("id, name, is_public")
      .eq("id", params.vehicleId)
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase
      .from("mods")
      .select("id, title, category, cost_cents, notes, installed_on, sort_order")
      .eq("id", params.modId)
      .eq("vehicle_id", params.vehicleId)
      .maybeSingle(),
  ]);

  if (vehicleError) {
    throw new Error(`Failed to load vehicle: ${vehicleError.message}`);
  }
  if (!vehicle) {
    notFound();
  }

  if (modError) {
    throw new Error(`Failed to load mod: ${modError.message}`);
  }
  if (!mod) {
    notFound();
  }

  const [
    { data: modOrder, error: modOrderError },
    { data: modImages, error: modImagesError },
    { count: totalImageCount, error: imageCountError },
  ] = await Promise.all([
    supabase
      .from("mods")
      .select("id")
      .eq("vehicle_id", params.vehicleId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("images")
      .select("id, caption, storage_bucket, storage_path, sort_order")
      .eq("mod_id", params.modId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", userId),
  ]);

  if (modOrderError) {
    throw new Error(`Failed to load mod order: ${modOrderError.message}`);
  }
  if (modImagesError) {
    throw new Error(`Failed to load mod images: ${modImagesError.message}`);
  }
  if (imageCountError) {
    throw new Error(`Failed to count images: ${imageCountError.message}`);
  }

  const resolvedModImageUrls = await getPublicImageUrlsForAnon(
    (modImages ?? []).map((image) => ({
      bucket: image.storage_bucket,
      storagePath: image.storage_path,
    }))
  );
  const modImageUrlsById: Record<string, string | null> = {};
  for (const [index, image] of ((modImages ?? []) as ModImageRow[]).entries()) {
    modImageUrlsById[image.id] = resolvedModImageUrls[index] ?? null;
  }

  const modIndex = (modOrder ?? []).findIndex((entry) => entry.id === mod.id);
  const canMoveUp = modIndex > 0;
  const canMoveDown =
    modIndex >= 0 && modIndex < Math.max((modOrder?.length ?? 0) - 1, 0);

  const status = getParam(searchParams, "status");
  const error = getParam(searchParams, "error");
  const limit = getParam(searchParams, "limit");
  const section = getParam(searchParams, "section");
  const modImagesRedirectTo = `${redirectTo}?section=mod-images#mod-images`;
  const imageLimitReached =
    !profile.is_pro && (totalImageCount ?? 0) >= FREE_TIER_LIMITS.imagesPerProfile;

  return (
    <main className="dashboard-page">
      <p className="back-link-row">
        <Link className="back-link" href={vehicleEditPath}>
          Back to vehicle
        </Link>
      </p>

      <section className="dashboard-heading-row">
        <div>
          <h1 className="dashboard-title">Edit Mod</h1>
          <p className="dashboard-subtitle">
            {mod.title} - {vehicle.name}
          </p>
        </div>
        {profile.username && vehicle.is_public ? (
          <Link className="auth-link" href={`/u/${profile.username}/v/${vehicle.id}`}>
            View public page
          </Link>
        ) : null}
      </section>

      {section !== "mod-images" && status ? (
        <p className="status-message">{status}</p>
      ) : null}
      {section !== "mod-images" && error ? (
        <p className="error-message">{error}</p>
      ) : null}

      <section className="dashboard-card">
        <h2 className="dashboard-section-title">Mod Details</h2>
        <ModForm
          action={updateModAction}
          vehicleId={vehicle.id}
          redirectTo={redirectTo}
          submitLabel="Save mod"
          mod={mod}
        />

        <div className="dashboard-inline-actions">
          <form action={moveModAction}>
            <input name="redirect_to" type="hidden" value={redirectTo} />
            <input name="vehicle_id" type="hidden" value={vehicle.id} />
            <input name="mod_id" type="hidden" value={mod.id} />
            <input name="direction" type="hidden" value="up" />
            <button className="secondary-button" type="submit" disabled={!canMoveUp}>
              Move up
            </button>
          </form>

          <form action={moveModAction}>
            <input name="redirect_to" type="hidden" value={redirectTo} />
            <input name="vehicle_id" type="hidden" value={vehicle.id} />
            <input name="mod_id" type="hidden" value={mod.id} />
            <input name="direction" type="hidden" value="down" />
            <button className="secondary-button" type="submit" disabled={!canMoveDown}>
              Move down
            </button>
          </form>

          <form action={deleteModAction}>
            <input name="redirect_to" type="hidden" value={vehicleEditPath} />
            <input name="vehicle_id" type="hidden" value={vehicle.id} />
            <input name="mod_id" type="hidden" value={mod.id} />
            <button className="danger-button" type="submit">
              Delete mod
            </button>
          </form>
        </div>
      </section>

      <section className="dashboard-card" id="mod-images">
        <h2 className="dashboard-section-title">Mod Images</h2>
        {section === "mod-images" && status ? (
          <p className="status-message">{status}</p>
        ) : null}
        {section === "mod-images" && error ? (
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
          parentType="mod"
          parentId={mod.id}
          vehicleId={vehicle.id}
          redirectTo={modImagesRedirectTo}
          buttonLabel="Upload mod image"
          disabled={imageLimitReached}
        />

        {(modImages?.length ?? 0) === 0 ? (
          <p className="empty-state">No images for this mod.</p>
        ) : (
          <div className="dashboard-image-grid">
            {modImages?.map((image) => {
              const url = modImageUrlsById[image.id] ?? null;
              if (!url) {
                return null;
              }

              return (
                <article className="dashboard-image-card" key={image.id}>
                  <img className="dashboard-image" src={url} alt={image.caption ?? "Mod image"} />
                  <div className="dashboard-image-actions">
                    {image.caption ? (
                      <p className="dashboard-image-caption">{image.caption}</p>
                    ) : null}
                    <form action={deleteImageAction}>
                      <input name="redirect_to" type="hidden" value={modImagesRedirectTo} />
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
    </main>
  );
}
