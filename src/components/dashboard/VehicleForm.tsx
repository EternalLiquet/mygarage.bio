import type { VehicleRow } from "@/lib/db/types";

type VehicleFormAction = (formData: FormData) => void | Promise<void>;

type VehicleFormProps = {
  action: VehicleFormAction;
  redirectTo: string;
  submitLabel: string;
  mode: "create" | "edit";
  vehicle?: Pick<
    VehicleRow,
    "id" | "name" | "year" | "make" | "model" | "trim" | "is_public"
  >;
  disabled?: boolean;
};

export function VehicleForm({
  action,
  redirectTo,
  submitLabel,
  mode,
  vehicle,
  disabled = false,
}: VehicleFormProps) {
  return (
    <form
      action={action}
      className="dashboard-form"
      encType="multipart/form-data"
      method="post"
    >
      <input name="redirect_to" type="hidden" value={redirectTo} />
      {vehicle?.id ? <input name="vehicle_id" type="hidden" value={vehicle.id} /> : null}

      <div className="form-grid">
        <label className="form-field">
          Vehicle Name
          <input
            name="name"
            required
            placeholder="My Project Car"
            defaultValue={vehicle?.name ?? ""}
            disabled={disabled}
          />
        </label>

        <label className="form-field">
          Year
          <input
            name="year"
            type="number"
            min={1900}
            max={2100}
            placeholder="2020"
            defaultValue={vehicle?.year ?? ""}
            disabled={disabled}
          />
        </label>

        <label className="form-field">
          Make
          <input name="make" placeholder="Toyota" defaultValue={vehicle?.make ?? ""} disabled={disabled} />
        </label>

        <label className="form-field">
          Model
          <input name="model" placeholder="Supra" defaultValue={vehicle?.model ?? ""} disabled={disabled} />
        </label>

        <label className="form-field">
          Trim
          <input name="trim" placeholder="GR" defaultValue={vehicle?.trim ?? ""} disabled={disabled} />
        </label>

        <label className="form-field">
          Cover Image
          <input name="hero_image_file" type="file" accept="image/*" disabled={disabled} />
        </label>
      </div>

      {mode === "edit" ? (
        <label className="form-checkbox">
          <input
            name="is_public"
            type="checkbox"
            defaultChecked={vehicle?.is_public ?? true}
            disabled={disabled}
          />
          Publicly visible
        </label>
      ) : null}

      <button className="primary-button" type="submit" disabled={disabled}>
        {submitLabel}
      </button>
    </form>
  );
}
