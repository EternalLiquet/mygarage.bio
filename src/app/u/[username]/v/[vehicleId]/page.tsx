/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageGrid } from "@/components/public/ImageGrid";
import { ModsList } from "@/components/public/ModsList";
import type { PublicImage, PublicMod } from "@/lib/db/queries";
import type { UUID } from "@/lib/db/types";
import {
  getPublicImagesForModIds,
  getPublicImagesForVehicle,
  getPublicMods,
  getPublicProfile,
  getPublicVehicle,
  getPublicVehicles,
} from "@/lib/db/queries";
import { getPublicImageUrlForAnon, getPublicImageUrlsForAnon } from "@/lib/media";
import { BUCKET_NAME } from "@/lib/storage";

type VehiclePageProps = {
  params: {
    username: string;
    vehicleId: string;
  };
};

export const revalidate = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function buildVehicleDetailsLine(vehicle: {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}): string {
  const parts = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Vehicle details coming soon";
}

function buildImagesByModId(mods: PublicMod[], modImages: PublicImage[]): Record<UUID, PublicImage[]> {
  const map: Record<UUID, PublicImage[]> = {};

  for (const mod of mods) {
    map[mod.id] = [];
  }

  for (const image of modImages) {
    if (!image.mod_id) {
      continue;
    }
    if (!map[image.mod_id]) {
      map[image.mod_id] = [];
    }
    map[image.mod_id].push(image);
  }

  return map;
}

const getResolvedVehicle = cache(async (username: string, vehicleId: string) => {
  const profile = await getPublicProfile(username);
  if (!profile) {
    return { profile: null, vehicle: null as null };
  }

  const [vehicle, profileVehicles] = await Promise.all([
    getPublicVehicle(vehicleId as UUID),
    getPublicVehicles({ username: profile.username }),
  ]);

  if (!vehicle) {
    return { profile, vehicle: null as null };
  }

  const belongsToProfile = profileVehicles.some(
    (candidate) =>
      candidate.id === vehicle.id && candidate.profile_id === vehicle.profile_id
  );

  if (!belongsToProfile) {
    return { profile, vehicle: null as null };
  }

  return { profile, vehicle };
});

const getCachedPublicMods = cache(async (vehicleId: UUID) => getPublicMods(vehicleId));

const getCachedVehiclePageData = cache(async (username: string, vehicleId: string) => {
  const resolved = await getResolvedVehicle(username, vehicleId);
  if (!resolved.profile || !resolved.vehicle) {
    return null;
  }

  const { profile, vehicle } = resolved;
  const [mods, vehicleImages] = await Promise.all([
    getCachedPublicMods(vehicle.id),
    getPublicImagesForVehicle(vehicle.id),
  ]);
  const modImages = await getPublicImagesForModIds(mods.map((mod) => mod.id));
  const imagesByModId = buildImagesByModId(mods, modImages);

  const [heroUrl, vehicleImageUrls, modImageUrls] = await Promise.all([
    getPublicImageUrlForAnon(BUCKET_NAME, vehicle.hero_image_path),
    getPublicImageUrlsForAnon(
      vehicleImages.map((image) => ({
        bucket: image.storage_bucket,
        storagePath: image.storage_path,
      }))
    ),
    getPublicImageUrlsForAnon(
      modImages.map((image) => ({
        bucket: image.storage_bucket,
        storagePath: image.storage_path,
      }))
    ),
  ]);

  const imageUrlsById: Record<string, string | null> = {};
  for (const [index, image] of vehicleImages.entries()) {
    imageUrlsById[image.id] = vehicleImageUrls[index] ?? null;
  }
  for (const [index, image] of modImages.entries()) {
    imageUrlsById[image.id] = modImageUrls[index] ?? null;
  }

  return {
    profile,
    vehicle,
    mods,
    vehicleImages,
    imagesByModId,
    imageUrlsById,
    heroUrl,
  };
});

export async function generateMetadata({
  params,
}: VehiclePageProps): Promise<Metadata> {
  if (!isUuid(params.vehicleId)) {
    return {
      title: "Vehicle not found | MyGarage.bio",
      description: "This vehicle page could not be found.",
    };
  }

  const { profile, vehicle } = await getResolvedVehicle(
    params.username,
    params.vehicleId
  );
  if (!profile || !vehicle) {
    return {
      title: "Vehicle not found | MyGarage.bio",
      description: "This vehicle page could not be found.",
    };
  }

  const mods = await getCachedPublicMods(vehicle.id);
  const description =
    `${buildVehicleDetailsLine(vehicle)}. ` +
    `${mods.length} ${mods.length === 1 ? "mod" : "mods"} documented.`;
  const heroUrl = await getPublicImageUrlForAnon(BUCKET_NAME, vehicle.hero_image_path);

  return {
    title: `${vehicle.name} | @${profile.username}`,
    description,
    alternates: {
      canonical: `/u/${encodeURIComponent(profile.username)}/v/${vehicle.id}`,
    },
    openGraph: {
      title: `${vehicle.name} | @${profile.username}`,
      description,
      type: "article",
      images: heroUrl ? [{ url: heroUrl }] : undefined,
    },
  };
}

export default async function PublicVehiclePage({ params }: VehiclePageProps) {
  if (!isUuid(params.vehicleId)) {
    notFound();
  }

  const data = await getCachedVehiclePageData(params.username, params.vehicleId);
  if (!data) {
    notFound();
  }

  const {
    profile,
    vehicle,
    mods,
    vehicleImages,
    imagesByModId,
    imageUrlsById,
    heroUrl,
  } = data;

  return (
    <main className="public-page">
      <p className="back-link-row">
        <Link className="back-link" href={`/u/${encodeURIComponent(profile.username)}`}>
          Back to @{profile.username}
        </Link>
      </p>

      <article className="vehicle-detail-card">
        <div className="vehicle-hero-wrap">
          {heroUrl ? (
            <img className="vehicle-hero" src={heroUrl} alt={`${vehicle.name} cover`} />
          ) : (
            <div className="vehicle-hero vehicle-card-placeholder">No cover image</div>
          )}
        </div>
        <div className="vehicle-detail-content">
          <p className="vehicle-owner-label">Build by @{profile.username}</p>
          <h1 className="vehicle-detail-title">{vehicle.name}</h1>
          <p className="vehicle-detail-line">{buildVehicleDetailsLine(vehicle)}</p>
          <p className="vehicle-detail-line">
            {mods.length} {mods.length === 1 ? "mod" : "mods"} documented
          </p>
        </div>
      </article>

      <section className="vehicle-section">
        <h2 className="section-heading">Photos</h2>
        <ImageGrid
          images={vehicleImages}
          emptyMessage="No vehicle photos yet."
          urlsByImageId={imageUrlsById}
        />
      </section>

      <section className="vehicle-section">
        <h2 className="section-heading">Mods</h2>
        <ModsList
          mods={mods}
          imagesByModId={imagesByModId}
          imageUrlsById={imageUrlsById}
        />
      </section>
    </main>
  );
}
