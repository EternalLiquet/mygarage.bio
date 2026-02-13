import type { PublicImage, PublicMod } from "@/lib/db/queries";
import type { UUID } from "@/lib/db/types";
import { ImageGrid } from "./ImageGrid";

type ModsListProps = {
  mods: PublicMod[];
  imagesByModId: Record<UUID, PublicImage[]>;
  imageUrlsById?: Record<string, string | null>;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatCost(costCents: number | null): string | null {
  if (costCents === null) {
    return null;
  }
  return currencyFormatter.format(costCents / 100);
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

export function ModsList({
  mods,
  imagesByModId,
  imageUrlsById,
}: ModsListProps) {
  if (mods.length === 0) {
    return <p className="mods-empty">No mods listed yet.</p>;
  }

  return (
    <div className="mods-list">
      {mods.map((mod) => {
        const cost = formatCost(mod.cost_cents);
        const installedOn = formatInstalledOn(mod.installed_on);
        const modImages = imagesByModId[mod.id] ?? [];

        return (
          <section className="mod-card" key={mod.id}>
            <div className="mod-card-header">
              <h3 className="mod-title">{mod.title}</h3>
              {mod.category ? <p className="mod-category">{mod.category}</p> : null}
            </div>
            <div className="mod-meta">
              {cost ? <span>{cost}</span> : null}
              {installedOn ? <span>Installed {installedOn}</span> : null}
            </div>
            {mod.notes ? <p className="mod-notes">{mod.notes}</p> : null}
            <ImageGrid
              images={modImages}
              emptyMessage="No photos for this mod yet."
              urlsByImageId={imageUrlsById}
            />
          </section>
        );
      })}
    </div>
  );
}
