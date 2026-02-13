type ImageUploaderAction = (formData: FormData) => void | Promise<void>;

type ImageUploaderProps = {
  action: ImageUploaderAction;
  parentType: "vehicle" | "mod";
  parentId: string;
  vehicleId: string;
  redirectTo: string;
  buttonLabel?: string;
  disabled?: boolean;
};

export function ImageUploader({
  action,
  parentType,
  parentId,
  vehicleId,
  redirectTo,
  buttonLabel = "Upload image",
  disabled = false,
}: ImageUploaderProps) {
  return (
    <form
      action={action}
      className="dashboard-form image-uploader"
      encType="multipart/form-data"
      method="post"
    >
      <input name="redirect_to" type="hidden" value={redirectTo} />
      <input name="vehicle_id" type="hidden" value={vehicleId} />
      <input name="parent_type" type="hidden" value={parentType} />
      <input name="parent_id" type="hidden" value={parentId} />

      <div className="form-grid">
        <label className="form-field">
          Image
          <input name="image_file" type="file" accept="image/*" required disabled={disabled} />
        </label>

        <label className="form-field">
          Caption (optional)
          <input name="caption" placeholder="Track day setup" disabled={disabled} />
        </label>
      </div>

      <button className="secondary-button" type="submit" disabled={disabled}>
        {buttonLabel}
      </button>
    </form>
  );
}
