import type { ModRow } from "@/lib/db/types";

type ModFormAction = (formData: FormData) => void | Promise<void>;

type ModFormProps = {
  action: ModFormAction;
  redirectTo: string;
  vehicleId: string;
  submitLabel: string;
  mod?: Pick<
    ModRow,
    "id" | "title" | "category" | "cost_cents" | "notes" | "installed_on"
  >;
  disabled?: boolean;
};

function toCostInputValue(costCents: number | null | undefined): string {
  if (typeof costCents !== "number") {
    return "";
  }
  return (costCents / 100).toFixed(2);
}

export function ModForm({
  action,
  redirectTo,
  vehicleId,
  submitLabel,
  mod,
  disabled = false,
}: ModFormProps) {
  return (
    <form
      action={action}
      className="dashboard-form mod-form"
      encType="multipart/form-data"
      method="post"
    >
      <input name="redirect_to" type="hidden" value={redirectTo} />
      <input name="vehicle_id" type="hidden" value={vehicleId} />
      {mod?.id ? <input name="mod_id" type="hidden" value={mod.id} /> : null}

      <div className="form-grid">
        <label className="form-field">
          Title
          <input
            name="title"
            required
            defaultValue={mod?.title ?? ""}
            placeholder="Exhaust upgrade"
            disabled={disabled}
          />
        </label>

        <label className="form-field">
          Category
          <input
            name="category"
            defaultValue={mod?.category ?? ""}
            placeholder="Performance"
            disabled={disabled}
          />
        </label>

        <label className="form-field">
          Cost (USD)
          <input
            name="cost"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            defaultValue={toCostInputValue(mod?.cost_cents)}
            placeholder="249.99"
            disabled={disabled}
          />
        </label>

        <label className="form-field">
          Installed On
          <input
            name="installed_on"
            type="date"
            defaultValue={mod?.installed_on ?? ""}
            disabled={disabled}
          />
        </label>

        <label className="form-field form-field-full">
          Notes
          <textarea
            className="dashboard-textarea"
            name="notes"
            defaultValue={mod?.notes ?? ""}
            placeholder="Optional install notes"
            disabled={disabled}
          />
        </label>

        <label className="form-field form-field-full">
          Upload Mod Image (optional)
          <input name="mod_image_file" type="file" accept="image/*" disabled={disabled} />
        </label>
      </div>

      <button className="primary-button" type="submit" disabled={disabled}>
        {submitLabel}
      </button>
    </form>
  );
}
