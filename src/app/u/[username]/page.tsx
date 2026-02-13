/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { VehicleCard } from "@/components/public/VehicleCard";
import {
  getPublicModCountsByVehicleIds,
  getPublicProfile,
  getPublicVehicles,
} from "@/lib/db/queries";
import { getPublicImageUrlForAnon, getPublicImageUrlsForAnon } from "@/lib/media";
import { BUCKET_NAME } from "@/lib/storage";

type ProfilePageProps = {
  params: {
    username: string;
  };
};

export const revalidate = 300;

function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured && configured.length > 0) {
    return configured.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}

function getDisplayName(displayName: string | null, username: string): string {
  if (displayName && displayName.trim().length > 0) {
    return displayName;
  }
  return username;
}

function getTitleName(displayName: string | null, username: string): string {
  if (displayName && displayName.trim().length > 0) {
    return displayName;
  }
  return `@${username}`;
}

const getCachedPublicProfile = cache(async (username: string) =>
  getPublicProfile(username)
);

const getCachedPublicProfilePageData = cache(async (username: string) => {
  const profile = await getCachedPublicProfile(username);
  if (!profile) {
    return null;
  }

  const vehicles = await getPublicVehicles({ username: profile.username });
  const modCounts = await getPublicModCountsByVehicleIds(
    vehicles.map((vehicle) => vehicle.id)
  );

  const imageInputs = [
    { bucket: BUCKET_NAME, storagePath: profile.avatar_image_path },
    ...vehicles.map((vehicle) => ({
      bucket: BUCKET_NAME,
      storagePath: vehicle.hero_image_path,
    })),
  ];
  const resolvedImageUrls = await getPublicImageUrlsForAnon(imageInputs);

  const heroUrlsByVehicleId: Record<string, string | null> = {};
  for (const [index, vehicle] of vehicles.entries()) {
    heroUrlsByVehicleId[vehicle.id] = resolvedImageUrls[index + 1] ?? null;
  }

  return {
    profile,
    vehicles,
    modCounts,
    avatarUrl: resolvedImageUrls[0] ?? null,
    heroUrlsByVehicleId,
  };
});

export async function generateMetadata({
  params,
}: ProfilePageProps): Promise<Metadata> {
  const profile = await getCachedPublicProfile(params.username);

  if (!profile) {
    return {
      title: "Profile not found | MyGarage.bio",
      description: "This garage profile could not be found.",
    };
  }

  const titleName = getTitleName(profile.display_name, profile.username);
  const description =
    profile.bio?.trim() || `Explore ${titleName}'s garage on MyGarage.bio.`;
  const avatarUrl = await getPublicImageUrlForAnon(BUCKET_NAME, profile.avatar_image_path);
  const canonicalUrl = `${getSiteUrl()}/u/${encodeURIComponent(profile.username)}`;

  return {
    title: `${titleName} | MyGarage.bio`,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${titleName} | MyGarage.bio`,
      description,
      type: "profile",
      images: avatarUrl ? [{ url: avatarUrl }] : undefined,
    },
  };
}

export default async function PublicProfilePage({ params }: ProfilePageProps) {
  const data = await getCachedPublicProfilePageData(params.username);
  if (!data) {
    notFound();
  }

  const { profile, vehicles, modCounts, avatarUrl, heroUrlsByVehicleId } = data;
  const displayName = getDisplayName(profile.display_name, profile.username);

  return (
    <main className="public-page">
      <section className="profile-header-card">
        <div className="profile-avatar-wrap">
          {avatarUrl ? (
            <img className="profile-avatar" src={avatarUrl} alt={`${displayName} avatar`} />
          ) : (
            <div className="profile-avatar profile-avatar-fallback" aria-hidden="true">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="profile-header-copy">
          <h1 className="profile-title">{displayName}</h1>
          <p className="profile-handle">@{profile.username}</p>
          {profile.bio ? (
            <p className="profile-bio">{profile.bio}</p>
          ) : (
            <p className="profile-bio profile-bio-empty">
              This garage has no bio yet.
            </p>
          )}
        </div>
      </section>

      <section className="vehicles-section">
        <div className="section-heading-row">
          <h2 className="section-heading">Garage</h2>
          <span className="section-count">{vehicles.length}</span>
        </div>
        {vehicles.length === 0 ? (
          <p className="empty-state">No public vehicles have been added yet.</p>
        ) : (
          <div className="vehicle-grid">
            {vehicles.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                username={profile.username}
                vehicle={vehicle}
                modCount={modCounts[vehicle.id] ?? 0}
                heroUrl={heroUrlsByVehicleId[vehicle.id] ?? null}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
