/* eslint-disable @next/next/no-img-element */
import type { PublicImage } from "@/lib/db/queries";
import { getPublicImageUrl } from "@/lib/media";

type ImageGridProps = {
  images: PublicImage[];
  emptyMessage?: string;
  urlsByImageId?: Record<string, string | null>;
};

export function ImageGrid({
  images,
  emptyMessage = "No photos added yet.",
  urlsByImageId,
}: ImageGridProps) {
  const renderableImages = images
    .map((image) => ({
      image,
      url:
        urlsByImageId?.[image.id] ??
        getPublicImageUrl(image.storage_bucket, image.storage_path),
    }))
    .filter(
      (item): item is { image: PublicImage; url: string } => typeof item.url === "string"
    );

  if (renderableImages.length === 0) {
    return <p className="image-grid-empty">{emptyMessage}</p>;
  }

  return (
    <div className="image-grid">
      {renderableImages.map(({ image, url }) => {
        return (
          <figure className="image-grid-item" key={image.id}>
            <img
              className="image-grid-image"
              src={url}
              alt={image.caption ?? "Build photo"}
              loading="lazy"
            />
            {image.caption ? (
              <figcaption className="image-grid-caption">{image.caption}</figcaption>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}
