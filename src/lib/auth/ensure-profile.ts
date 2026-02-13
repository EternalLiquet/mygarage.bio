import "server-only";

import type { ProfileRow } from "@/lib/db/types";
import type { createServerClient } from "@/lib/supabase/server";

const DEFAULT_PROFILE_DISPLAY_NAME = "My Garage";

export async function ensureProfileExists(
  supabase: ReturnType<typeof createServerClient>,
  userId: string
): Promise<ProfileRow> {
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (existingProfileError) {
    throw new Error(`Failed to load profile: ${existingProfileError.message}`);
  }

  if (existingProfile) {
    return existingProfile;
  }

  const { error: upsertError } = await supabase.from("profiles").upsert(
    {
      id: userId,
      username: null,
      display_name: DEFAULT_PROFILE_DISPLAY_NAME,
    },
    {
      onConflict: "id",
      ignoreDuplicates: true,
    }
  );

  if (upsertError) {
    throw new Error(`Failed to ensure profile: ${upsertError.message}`);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Failed to load profile: ${profileError.message}`);
  }

  if (!profile) {
    throw new Error("Profile not found after ensure.");
  }

  return profile;
}
