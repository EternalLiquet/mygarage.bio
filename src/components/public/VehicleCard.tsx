/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { PublicVehicle } from "@/lib/db/queries";

type VehicleCardProps = {
  username: string;
  vehicle: PublicVehicle;
  modCount: number;
  heroUrl?: string | null;
};

function buildVehicleLabel(vehicle: PublicVehicle): string {
  const details = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(
    Boolean
  );
  return details.length > 0 ? details.join(" ") : "Build details coming soon";
}

export function VehicleCard({
  username,
  vehicle,
  modCount,
  heroUrl,
}: VehicleCardProps) {
  const href = `/u/${encodeURIComponent(username)}/v/${vehicle.id}`;

  return (
    <Link className="vehicle-card" href={href}>
      <div className="vehicle-card-image-wrap">
        {heroUrl ? (
          <img
            className="vehicle-card-image"
            src={heroUrl}
            alt={`${vehicle.name} cover`}
            loading="lazy"
          />
        ) : (
          <div className="vehicle-card-image vehicle-card-placeholder">
            No cover image
          </div>
        )}
      </div>
      <div className="vehicle-card-content">
        <h2 className="vehicle-card-title">{vehicle.name}</h2>
        <p className="vehicle-card-subtitle">{buildVehicleLabel(vehicle)}</p>
        <p className="vehicle-card-meta">
          {modCount} {modCount === 1 ? "mod" : "mods"}
        </p>
      </div>
    </Link>
  );
}
