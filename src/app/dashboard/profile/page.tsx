/* eslint-disable @next/next/no-img-element */
import {
  checkUsernameAvailabilityAction,
  updateProfileAction,
} from "@/app/dashboard/actions";
import { ensureProfileExists } from "@/lib/auth/ensure-profile";
import { getDashboardUserIdOrRedirect } from "@/lib/auth/dashboard-request";
import { getPublicImageUrlForAnon } from "@/lib/media";
import { BUCKET_NAME } from "@/lib/storage";
import { createServerClient } from "@/lib/supabase/server";

type ProfilePageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(
  searchParams: ProfilePageProps["searchParams"],
  key: string
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default async function DashboardProfilePage({ searchParams }: ProfilePageProps) {
  const supabase = createServerClient();
  const userId = getDashboardUserIdOrRedirect("/dashboard/profile");

  const profile = await ensureProfileExists(supabase, userId);

  const status = getParam(searchParams, "status");
  const error = getParam(searchParams, "error");
  const checked = getParam(searchParams, "checked");
  const availability = getParam(searchParams, "availability");
  const usernameValue = checked ?? profile.username ?? "";

  const avatarUrl = await getPublicImageUrlForAnon(BUCKET_NAME, profile.avatar_image_path);

  return (
    <main className="dashboard-page">
      <section className="dashboard-heading-row">
        <div>
          <h1 className="dashboard-title">Edit Profile</h1>
          <p className="dashboard-subtitle">Update your public identity and avatar.</p>
        </div>
      </section>

      {status ? <p className="status-message">{status}</p> : null}
      {error ? <p className="error-message">{error}</p> : null}

      <section className="dashboard-card">
        <div className="profile-editor-header">
          {avatarUrl ? (
            <img className="profile-avatar" src={avatarUrl} alt="Current avatar" />
          ) : (
            <div className="profile-avatar profile-avatar-fallback" aria-hidden="true">
              {(profile.display_name ?? profile.username ?? "U").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <p className="dashboard-item-title">{profile.display_name ?? "Unnamed profile"}</p>
            <p className="dashboard-item-subtitle">
              {profile.username ? `@${profile.username}` : "Profile unpublished"}
            </p>
          </div>
        </div>

        <form
          action={updateProfileAction}
          className="dashboard-form"
          encType="multipart/form-data"
          method="post"
        >
          <input name="redirect_to" type="hidden" value="/dashboard/profile" />

          <div className="form-grid">
            <label className="form-field">
              Username
              <input name="username" defaultValue={usernameValue} />
            </label>

            <label className="form-field">
              Display Name
              <input name="display_name" defaultValue={profile.display_name ?? ""} />
            </label>

            <label className="form-field form-field-full">
              Bio
              <textarea
                className="dashboard-textarea"
                name="bio"
                defaultValue={profile.bio ?? ""}
                placeholder="Tell people about your garage build."
              />
            </label>

            <label className="form-field form-field-full">
              Avatar Image
              <input name="avatar_file" type="file" accept="image/*" />
            </label>
          </div>

          <div className="dashboard-inline-actions">
            <button className="secondary-button" formAction={checkUsernameAvailabilityAction}>
              Check username
            </button>
            <button className="primary-button" type="submit">
              Save profile
            </button>
          </div>
        </form>

        {checked ? (
          <p className={availability === "available" ? "status-message" : "error-message"}>
            Username @{checked} is{" "}
            {availability === "available" ? "available." : "not available."}
          </p>
        ) : null}
      </section>
    </main>
  );
}
