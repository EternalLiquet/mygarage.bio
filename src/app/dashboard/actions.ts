"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ensureProfileExists } from "@/lib/auth/ensure-profile";
import { createServerClient } from "@/lib/supabase/server";
import { FREE_TIER_LIMITS, isValidUsername, normalizeUsername } from "@/lib/limits";
import {
  enforceServerActionRateLimit,
  RateLimitExceededError,
} from "@/lib/security/rate-limit";
import { BUCKET_NAME } from "@/lib/storage";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Direction = "up" | "down";
type ReorderSwapOutcome = "moved" | "boundary" | "not_found";

type AuthContext = {
  supabase: ReturnType<typeof createServerClient>;
  userId: string;
  profile: {
    id: string;
    is_pro: boolean;
    username: string | null;
  };
};

type ActionRateLimitConfig = {
  action: string;
  message: string;
  user: {
    maxRequests: number;
    windowMs: number;
  };
  ip: {
    maxRequests: number;
    windowMs: number;
  };
};

const ACTION_RATE_LIMITS = {
  checkUsernameAvailability: {
    action: "dashboard-check-username",
    message: "Too many username checks.",
    user: { maxRequests: 15, windowMs: 60_000 },
    ip: { maxRequests: 45, windowMs: 60_000 },
  },
  updateProfile: {
    action: "dashboard-update-profile",
    message: "Too many profile updates.",
    user: { maxRequests: 8, windowMs: 60_000 },
    ip: { maxRequests: 24, windowMs: 60_000 },
  },
  createVehicle: {
    action: "dashboard-create-vehicle",
    message: "Too many vehicle create requests.",
    user: { maxRequests: 12, windowMs: 60_000 },
    ip: { maxRequests: 40, windowMs: 60_000 },
  },
  updateVehicle: {
    action: "dashboard-update-vehicle",
    message: "Too many vehicle update requests.",
    user: { maxRequests: 20, windowMs: 60_000 },
    ip: { maxRequests: 60, windowMs: 60_000 },
  },
  moveVehicle: {
    action: "dashboard-move-vehicle",
    message: "Too many vehicle reorder requests.",
    user: { maxRequests: 30, windowMs: 60_000 },
    ip: { maxRequests: 90, windowMs: 60_000 },
  },
  deleteVehicle: {
    action: "dashboard-delete-vehicle",
    message: "Too many vehicle delete requests.",
    user: { maxRequests: 10, windowMs: 60_000 },
    ip: { maxRequests: 30, windowMs: 60_000 },
  },
  createMod: {
    action: "dashboard-create-mod",
    message: "Too many mod create requests.",
    user: { maxRequests: 20, windowMs: 60_000 },
    ip: { maxRequests: 60, windowMs: 60_000 },
  },
  updateMod: {
    action: "dashboard-update-mod",
    message: "Too many mod update requests.",
    user: { maxRequests: 25, windowMs: 60_000 },
    ip: { maxRequests: 75, windowMs: 60_000 },
  },
  moveMod: {
    action: "dashboard-move-mod",
    message: "Too many mod reorder requests.",
    user: { maxRequests: 40, windowMs: 60_000 },
    ip: { maxRequests: 120, windowMs: 60_000 },
  },
  deleteMod: {
    action: "dashboard-delete-mod",
    message: "Too many mod delete requests.",
    user: { maxRequests: 15, windowMs: 60_000 },
    ip: { maxRequests: 45, windowMs: 60_000 },
  },
  uploadImage: {
    action: "dashboard-upload-image",
    message: "Too many image uploads.",
    user: { maxRequests: 8, windowMs: 60_000 },
    ip: { maxRequests: 24, windowMs: 60_000 },
  },
  deleteImage: {
    action: "dashboard-delete-image",
    message: "Too many image delete requests.",
    user: { maxRequests: 25, windowMs: 60_000 },
    ip: { maxRequests: 75, windowMs: 60_000 },
  },
} as const satisfies Record<string, ActionRateLimitConfig>;

const USER_SAFE_MESSAGES = {
  usernameCheckFailed: "Could not check username right now. Please try again.",
  usernameValidateFailed: "Could not validate username right now. Please try again.",
  profileSaveFailed: "Could not save profile right now. Please try again.",
  vehicleSortPrepareFailed: "Could not prepare vehicle right now. Please try again.",
  vehicleCreateFailed: "Could not create vehicle right now. Please try again.",
  vehicleCreateHeroFailed:
    "Vehicle created, but the cover image could not be saved.",
  vehicleUpdateFailed: "Could not update vehicle right now. Please try again.",
  vehicleUpdateHeroFailed:
    "Vehicle updated, but the cover image could not be saved.",
  vehicleReorderFailed: "Could not reorder vehicles right now. Please try again.",
  vehicleDeleteFailed: "Could not delete vehicle right now. Please try again.",
  modSortPrepareFailed: "Could not prepare mod right now. Please try again.",
  modCreateFailed: "Could not create mod right now. Please try again.",
  modCreateImageFailed: "Mod created, but the image could not be saved.",
  modUpdateFailed: "Could not update mod right now. Please try again.",
  modUpdateImageFailed: "Mod updated, but the image could not be saved.",
  modReorderFailed: "Could not reorder mods right now. Please try again.",
  modDeleteFailed: "Could not delete mod right now. Please try again.",
  modLookupForImageUploadFailed:
    "Could not verify mod for image upload right now. Please try again.",
  imageUploadFailed: "Could not upload image right now. Please try again.",
  imageUploadMetadataFailed:
    "Image uploaded, but details could not be saved right now.",
  imageSaveFailed: "Could not save image details right now. Please try again.",
  imageLookupFailed: "Could not load image details right now. Please try again.",
  imageDeleteFailed: "Could not delete image right now. Please try again.",
} as const;

type UserSafeMessageKey = keyof typeof USER_SAFE_MESSAGES;

type LogContextValue = string | number | boolean | null | undefined;
type LogContext = Record<string, LogContextValue>;

function getUserSafeMessage(key: UserSafeMessageKey): string {
  return USER_SAFE_MESSAGES[key];
}

function logInternalActionError(options: {
  action: string;
  error: unknown;
  redirectPath: string;
  userId?: string;
  context?: LogContext;
}) {
  const payload = {
    event: "dashboard_action_error",
    action: options.action,
    redirectPath: options.redirectPath,
    userId: options.userId ?? null,
    ...(options.context ?? {}),
  };

  if (options.error instanceof Error) {
    console.error({
      ...payload,
      errorName: options.error.name,
      errorMessage: options.error.message,
      errorStack: options.error.stack ?? null,
    });
    return;
  }

  let serializedError = String(options.error);
  if (typeof options.error !== "string") {
    try {
      serializedError = JSON.stringify(options.error);
    } catch {
      serializedError = "[unserializable_error]";
    }
  }

  console.error({
    ...payload,
    errorValue: serializedError,
  });
}

function redirectWithLoggedSafeError(options: {
  action: string;
  error: unknown;
  redirectPath: string;
  messageKey: UserSafeMessageKey;
  userId?: string;
  context?: LogContext;
}): never {
  logInternalActionError({
    action: options.action,
    error: options.error,
    redirectPath: options.redirectPath,
    userId: options.userId,
    context: options.context,
  });

  redirectWithStatus(options.redirectPath, {
    error: getUserSafeMessage(options.messageKey),
  });
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function toSingleValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseReorderSwapOutcome(value: unknown): ReorderSwapOutcome | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    return null;
  }

  const outcome = (row as { outcome?: unknown }).outcome;
  if (outcome === "moved" || outcome === "boundary" || outcome === "not_found") {
    return outcome;
  }

  return null;
}

function toOptionalText(value: FormDataEntryValue | null): string | null {
  const text = toSingleValue(value);
  return text.length > 0 ? text : null;
}

function toSafeRedirectPath(rawPath: FormDataEntryValue | null, fallback: string): string {
  const path = toSingleValue(rawPath);
  if (!path.startsWith("/")) {
    return fallback;
  }
  return path;
}

function withParams(
  pathname: string,
  params: Record<string, string | null | undefined>
): string {
  const base = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const url = new URL(base, "http://localhost");
  for (const [key, value] of Object.entries(params)) {
    if (value && value.length > 0) {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function parseOptionalInteger(
  value: FormDataEntryValue | null,
  fieldName: string
): number | null {
  const text = toSingleValue(value);
  if (!text) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return parsed;
}

function parseOptionalCostCents(value: FormDataEntryValue | null): number | null {
  const text = toSingleValue(value);
  if (!text) {
    return null;
  }

  const normalized = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Cost must be a valid amount, like 249.99.");
  }

  const [wholeText, fractionalText = ""] = normalized.split(".");
  const whole = BigInt(wholeText);
  const fractional = BigInt(fractionalText.padEnd(2, "0"));
  const cents = whole * 100n + fractional;

  if (cents < 0n) {
    throw new Error("Cost must be zero or greater.");
  }
  if (cents > 2147483647n) {
    throw new Error("Cost is too large.");
  }

  return Number(cents);
}

function parseOptionalDate(value: FormDataEntryValue | null): string | null {
  const text = toSingleValue(value);
  if (!text) {
    return null;
  }

  const date = new Date(text);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("Invalid installation date.");
  }

  return text;
}

function parseOptionalIntegerOrRedirect(
  value: FormDataEntryValue | null,
  fieldName: string,
  redirectPath: string
): number | null {
  try {
    return parseOptionalInteger(value, fieldName);
  } catch {
    redirectWithStatus(redirectPath, { error: `Invalid ${fieldName}.` });
  }
}

function parseOptionalCostCentsOrRedirect(
  value: FormDataEntryValue | null,
  redirectPath: string
): number | null {
  try {
    return parseOptionalCostCents(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid cost.";
    redirectWithStatus(redirectPath, { error: message });
  }
}

function parseOptionalDateOrRedirect(
  value: FormDataEntryValue | null,
  redirectPath: string
): string | null {
  try {
    return parseOptionalDate(value);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid installation date.";
    redirectWithStatus(redirectPath, { error: message });
  }
}

function validateMaxLengthOrRedirect(
  value: string | null,
  maxLength: number,
  fieldLabel: string,
  redirectPath: string
) {
  if (value && value.length > maxLength) {
    redirectWithStatus(redirectPath, {
      error: `${fieldLabel} must be ${maxLength} characters or fewer.`,
    });
  }
}

function validateYearRangeOrRedirect(year: number | null, redirectPath: string) {
  if (year === null) {
    return;
  }

  const maxYear = new Date().getUTCFullYear() + 1;
  if (year < 1886 || year > maxYear) {
    redirectWithStatus(redirectPath, {
      error: `Year must be between 1886 and ${maxYear}.`,
    });
  }
}

function getUploadFile(
  formData: FormData,
  key: string,
  redirectPath: string
): File | null {
  const value = formData.get(key);
  if (!(value instanceof File) || value.size <= 0) {
    return null;
  }

  if (value.size > MAX_UPLOAD_BYTES) {
    redirectWithStatus(redirectPath, {
      error: "Image must be 5MB or smaller.",
    });
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(value.type)) {
    redirectWithStatus(redirectPath, {
      error: "Only JPEG, PNG, or WEBP images are allowed.",
    });
  }

  return value;
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) {
    return "bin";
  }

  const ext = fileName.slice(dotIndex + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext.length > 0 ? ext : "bin";
}

async function uploadFile(
  supabase: ReturnType<typeof createServerClient>,
  file: File,
  prefix: string,
  redirectPath: string
): Promise<string> {
  const extension = getFileExtension(file.name);
  const path = `${prefix}/${crypto.randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from(BUCKET_NAME).upload(path, buffer, {
    contentType: file.type || undefined,
    upsert: false,
  });

  if (error) {
    redirectWithLoggedSafeError({
      action: "upload_file",
      error,
      redirectPath,
      messageKey: "imageUploadFailed",
      context: {
        prefix,
        fileType: file.type || null,
        fileSize: file.size,
      },
    });
  }

  return path;
}

async function getAuthContext(): Promise<AuthContext> {
  const supabase = createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?next=/dashboard");
  }

  const profile = await ensureProfileExists(supabase, user.id);

  return {
    supabase,
    userId: user.id,
    profile: {
      id: profile.id,
      is_pro: profile.is_pro,
      username: profile.username,
    },
  };
}

async function getVehicleCount(
  supabase: ReturnType<typeof createServerClient>,
  profileId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("vehicles")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId);

  if (error) {
    throw new Error(`Failed to count vehicles: ${error.message}`);
  }

  return count ?? 0;
}

async function getModCount(
  supabase: ReturnType<typeof createServerClient>,
  vehicleId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("mods")
    .select("id", { count: "exact", head: true })
    .eq("vehicle_id", vehicleId);

  if (error) {
    throw new Error(`Failed to count mods: ${error.message}`);
  }

  return count ?? 0;
}

async function getImageCount(
  supabase: ReturnType<typeof createServerClient>,
  profileId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId);

  if (error) {
    throw new Error(`Failed to count images: ${error.message}`);
  }

  return count ?? 0;
}

async function getOwnedVehicle(
  supabase: ReturnType<typeof createServerClient>,
  profileId: string,
  vehicleId: string
): Promise<{ id: string; sort_order: number; is_public: boolean; name: string } | null> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, sort_order, is_public, name")
    .eq("id", vehicleId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load vehicle: ${error.message}`);
  }

  return data;
}

async function getOwnedMod(
  supabase: ReturnType<typeof createServerClient>,
  vehicleId: string,
  modId: string
): Promise<{ id: string; sort_order: number } | null> {
  const { data, error } = await supabase
    .from("mods")
    .select("id, sort_order")
    .eq("id", modId)
    .eq("vehicle_id", vehicleId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load mod: ${error.message}`);
  }

  return data;
}

function revalidateDashboardPaths(vehicleId?: string, username?: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/vehicles/new");

  if (vehicleId) {
    revalidatePath(`/dashboard/vehicles/${vehicleId}/edit`);
  }

  if (username) {
    revalidatePath(`/u/${username}`);
    if (vehicleId) {
      revalidatePath(`/u/${username}/v/${vehicleId}`);
    }
  }
}

function redirectWithStatus(
  path: string,
  options: {
    status?: string;
    error?: string;
    detail?: string;
    limit?: "vehicles" | "mods" | "images";
    checkedUsername?: string;
    usernameAvailability?: "available" | "taken";
  }
): never {
  redirect(
    withParams(path, {
      status: options.status ?? null,
      error: options.error ?? null,
      detail: options.detail ?? null,
      limit: options.limit ?? null,
      checked: options.checkedUsername ?? null,
      availability: options.usernameAvailability ?? null,
    })
  );
}

type ActionRateLimitKey = keyof typeof ACTION_RATE_LIMITS;

async function enforceRateLimitOrRedirect(
  context: AuthContext,
  key: ActionRateLimitKey,
  redirectPath: string
) {
  const config = ACTION_RATE_LIMITS[key];

  try {
    await enforceServerActionRateLimit({
      action: config.action,
      userId: context.userId,
      userLimit: config.user,
      ipLimit: config.ip,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      const waitText =
        error.retryAfterSeconds <= 1
          ? "a moment"
          : `${error.retryAfterSeconds} seconds`;
      redirectWithStatus(redirectPath, {
        error: `${config.message} Please wait ${waitText} and try again.`,
      });
    }

    redirectWithStatus(redirectPath, {
      error: "Request blocked. Please try again shortly.",
    });
  }
}

async function enforceVehicleLimitOrRedirect(context: AuthContext, redirectPath: string) {
  if (context.profile.is_pro) {
    return;
  }

  const count = await getVehicleCount(context.supabase, context.profile.id);
  if (count >= FREE_TIER_LIMITS.vehicles) {
    redirectWithStatus(redirectPath, {
      error: "Free plan allows one vehicle.",
      limit: "vehicles",
    });
  }
}

async function enforceModLimitOrRedirect(
  context: AuthContext,
  vehicleId: string,
  redirectPath: string
) {
  if (context.profile.is_pro) {
    return;
  }

  const count = await getModCount(context.supabase, vehicleId);
  if (count >= FREE_TIER_LIMITS.modsPerVehicle) {
    redirectWithStatus(redirectPath, {
      error: "Free plan allows up to 10 mods per vehicle.",
      limit: "mods",
    });
  }
}

async function enforceImageLimitOrRedirect(context: AuthContext, redirectPath: string) {
  if (context.profile.is_pro) {
    return;
  }

  const count = await getImageCount(context.supabase, context.profile.id);
  if (count >= FREE_TIER_LIMITS.imagesPerProfile) {
    redirectWithStatus(redirectPath, {
      error: "Free plan allows up to 10 images total.",
      limit: "images",
    });
  }
}

export async function checkUsernameAvailabilityAction(formData: FormData) {
  const redirectPath = toSafeRedirectPath(formData.get("redirect_to"), "/dashboard/profile");
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "checkUsernameAvailability", redirectPath);
  const username = normalizeUsername(toSingleValue(formData.get("username")));

  if (!isValidUsername(username)) {
    redirectWithStatus(redirectPath, {
      error: "Username must be 3-30 chars: lowercase letters, numbers, underscores.",
      checkedUsername: username,
    });
  }

  const { data: match, error } = await context.supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    redirectWithLoggedSafeError({
      action: "check_username_availability",
      error,
      redirectPath,
      messageKey: "usernameCheckFailed",
      userId: context.userId,
      context: { username },
    });
  }

  const available = !match || match.id === context.userId;
  redirectWithStatus(redirectPath, {
    checkedUsername: username,
    usernameAvailability: available ? "available" : "taken",
    status: available ? "Username is available." : undefined,
    error: available ? undefined : "Username is already taken.",
  });
}

export async function updateProfileAction(formData: FormData) {
  const redirectPath = toSafeRedirectPath(formData.get("redirect_to"), "/dashboard/profile");
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "updateProfile", redirectPath);

  const rawUsername = toSingleValue(formData.get("username"));
  const username = rawUsername ? normalizeUsername(rawUsername) : null;
  const displayName = toOptionalText(formData.get("display_name"));
  const bio = toOptionalText(formData.get("bio"));
  const avatarFile = getUploadFile(formData, "avatar_file", redirectPath);

  validateMaxLengthOrRedirect(displayName, 60, "Display name", redirectPath);
  validateMaxLengthOrRedirect(bio, 300, "Bio", redirectPath);

  if (username && !isValidUsername(username)) {
    redirectWithStatus(redirectPath, {
      error: "Username must be 3-30 chars: lowercase letters, numbers, underscores.",
    });
  }

  if (username) {
    const { data: usernameConflict, error: usernameCheckError } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (usernameCheckError) {
      redirectWithLoggedSafeError({
        action: "update_profile_username_validate",
        error: usernameCheckError,
        redirectPath,
        messageKey: "usernameValidateFailed",
        userId: context.userId,
        context: { username },
      });
    }

    if (usernameConflict && usernameConflict.id !== context.userId) {
      redirectWithStatus(redirectPath, {
        error: "That username is already taken.",
        checkedUsername: username,
        usernameAvailability: "taken",
      });
    }
  }

  let avatarPath: string | null | undefined;
  if (avatarFile) {
    avatarPath = await uploadFile(
      context.supabase,
      avatarFile,
      `avatars/${context.userId}`,
      redirectPath
    );
  }

  const { error: updateError } = await context.supabase
    .from("profiles")
    .update({
      username,
      display_name: displayName,
      bio,
      ...(avatarPath ? { avatar_image_path: avatarPath } : {}),
    })
    .eq("id", context.userId);

  if (updateError) {
    redirectWithLoggedSafeError({
      action: "update_profile",
      error: updateError,
      redirectPath,
      messageKey: "profileSaveFailed",
      userId: context.userId,
      context: { username },
    });
  }

  revalidateDashboardPaths(undefined, username ?? null);
  if (context.profile.username && context.profile.username !== username) {
    revalidatePath(`/u/${context.profile.username}`);
  }

  redirectWithStatus(redirectPath, { status: "Profile saved." });
}

export async function createVehicleAction(formData: FormData) {
  const redirectPath = toSafeRedirectPath(
    formData.get("redirect_to"),
    "/dashboard/vehicles/new"
  );
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "createVehicle", redirectPath);

  await enforceVehicleLimitOrRedirect(context, redirectPath);

  const name = toSingleValue(formData.get("name"));
  const year = parseOptionalIntegerOrRedirect(formData.get("year"), "year", redirectPath);
  const make = toOptionalText(formData.get("make"));
  const model = toOptionalText(formData.get("model"));
  const trim = toOptionalText(formData.get("trim"));
  const heroFile = getUploadFile(formData, "hero_image_file", redirectPath);

  validateYearRangeOrRedirect(year, redirectPath);

  if (!name) {
    redirectWithStatus(redirectPath, { error: "Vehicle name is required." });
  }

  const { data: lastVehicle, error: lastVehicleError } = await context.supabase
    .from("vehicles")
    .select("sort_order")
    .eq("profile_id", context.profile.id)
    .order("sort_order", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastVehicleError) {
    redirectWithLoggedSafeError({
      action: "create_vehicle_prepare_sort",
      error: lastVehicleError,
      redirectPath,
      messageKey: "vehicleSortPrepareFailed",
      userId: context.userId,
    });
  }

  const nextSortOrder = (lastVehicle?.sort_order ?? -1) + 1;
  const { data: vehicle, error: createError } = await context.supabase
    .from("vehicles")
    .insert({
      profile_id: context.userId,
      name,
      year,
      make,
      model,
      trim,
      is_public: true,
      sort_order: nextSortOrder,
    })
    .select("id")
    .single();

  if (createError || !vehicle) {
    redirectWithLoggedSafeError({
      action: "create_vehicle",
      error: createError ?? new Error("Vehicle insert returned no row."),
      redirectPath,
      messageKey: "vehicleCreateFailed",
      userId: context.userId,
    });
  }

  if (heroFile) {
    const heroPath = await uploadFile(
      context.supabase,
      heroFile,
      `vehicles/${vehicle.id}`,
      `/dashboard/vehicles/${vehicle.id}/edit`
    );
    const { error: heroError } = await context.supabase
      .from("vehicles")
      .update({ hero_image_path: heroPath })
      .eq("id", vehicle.id)
      .eq("profile_id", context.profile.id);

    if (heroError) {
      redirectWithLoggedSafeError({
        action: "create_vehicle_save_hero",
        error: heroError,
        redirectPath: `/dashboard/vehicles/${vehicle.id}/edit`,
        messageKey: "vehicleCreateHeroFailed",
        userId: context.userId,
        context: { vehicleId: vehicle.id },
      });
    }
  }

  revalidateDashboardPaths(vehicle.id, context.profile.username);
  redirectWithStatus(`/dashboard/vehicles/${vehicle.id}/edit`, {
    status: "Vehicle created.",
  });
}

export async function updateVehicleAction(formData: FormData) {
  const vehicleId = toSingleValue(formData.get("vehicle_id"));
  const redirectPath = toSafeRedirectPath(
    formData.get("redirect_to"),
    `/dashboard/vehicles/${vehicleId}/edit`
  );
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "updateVehicle", redirectPath);

  if (!isUuid(vehicleId)) {
    redirectWithStatus(redirectPath, { error: "Invalid vehicle id." });
  }

  const vehicle = await getOwnedVehicle(context.supabase, context.profile.id, vehicleId);
  if (!vehicle) {
    redirectWithStatus(redirectPath, { error: "Vehicle not found." });
  }

  const name = toSingleValue(formData.get("name"));
  const year = parseOptionalIntegerOrRedirect(formData.get("year"), "year", redirectPath);
  const make = toOptionalText(formData.get("make"));
  const model = toOptionalText(formData.get("model"));
  const trim = toOptionalText(formData.get("trim"));
  const isPublic = formData.get("is_public") === "on";
  const heroFile = getUploadFile(formData, "hero_image_file", redirectPath);

  validateYearRangeOrRedirect(year, redirectPath);

  if (!name) {
    redirectWithStatus(redirectPath, { error: "Vehicle name is required." });
  }

  const { error: updateError } = await context.supabase
    .from("vehicles")
    .update({
      name,
      year,
      make,
      model,
      trim,
      is_public: isPublic,
    })
    .eq("id", vehicleId)
    .eq("profile_id", context.profile.id);

  if (updateError) {
    redirectWithLoggedSafeError({
      action: "update_vehicle",
      error: updateError,
      redirectPath,
      messageKey: "vehicleUpdateFailed",
      userId: context.userId,
      context: { vehicleId },
    });
  }

  if (heroFile) {
    const heroPath = await uploadFile(
      context.supabase,
      heroFile,
      `vehicles/${vehicleId}`,
      redirectPath
    );
    const { error: heroError } = await context.supabase
      .from("vehicles")
      .update({ hero_image_path: heroPath })
      .eq("id", vehicleId)
      .eq("profile_id", context.profile.id);

    if (heroError) {
      redirectWithLoggedSafeError({
        action: "update_vehicle_save_hero",
        error: heroError,
        redirectPath,
        messageKey: "vehicleUpdateHeroFailed",
        userId: context.userId,
        context: { vehicleId },
      });
    }
  }

  revalidateDashboardPaths(vehicleId, context.profile.username);
  redirectWithStatus(redirectPath, { status: "Vehicle updated." });
}

export async function moveVehicleAction(formData: FormData) {
  const vehicleId = toSingleValue(formData.get("vehicle_id"));
  const directionRaw = toSingleValue(formData.get("direction"));
  const redirectPath = toSafeRedirectPath(
    formData.get("redirect_to"),
    `/dashboard/vehicles/${vehicleId}/edit`
  );
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "moveVehicle", redirectPath);

  if (!isUuid(vehicleId)) {
    redirectWithStatus(redirectPath, { error: "Invalid vehicle id." });
  }
  if (directionRaw !== "up" && directionRaw !== "down") {
    redirectWithStatus(redirectPath, { error: "Invalid move direction." });
  }
  const direction: Direction = directionRaw;

  const { data: reorderResult, error: reorderError } = await context.supabase.rpc(
    "reorder_vehicle_swap",
    {
      p_vehicle_id: vehicleId,
      p_direction: direction,
    }
  );

  if (reorderError) {
    redirectWithLoggedSafeError({
      action: "move_vehicle_swap_rpc",
      error: reorderError,
      redirectPath,
      messageKey: "vehicleReorderFailed",
      userId: context.userId,
      context: { vehicleId, direction },
    });
  }

  const outcome = parseReorderSwapOutcome(reorderResult);
  if (!outcome) {
    redirectWithLoggedSafeError({
      action: "move_vehicle_swap_parse_result",
      error: new Error("Unexpected reorder_vehicle_swap response shape."),
      redirectPath,
      messageKey: "vehicleReorderFailed",
      userId: context.userId,
      context: { vehicleId, direction, resultType: typeof reorderResult },
    });
  }

  if (outcome === "not_found") {
    redirectWithStatus(redirectPath, { error: "Vehicle not found." });
  }

  if (outcome === "boundary") {
    redirectWithStatus(redirectPath, { status: "Vehicle is already at this position." });
  }

  revalidateDashboardPaths(vehicleId, context.profile.username);
  redirectWithStatus(redirectPath, { status: "Vehicle reordered." });
}

export async function deleteVehicleAction(formData: FormData) {
  const vehicleId = toSingleValue(formData.get("vehicle_id"));
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "deleteVehicle", "/dashboard");

  if (!isUuid(vehicleId)) {
    redirectWithStatus("/dashboard", { error: "Invalid vehicle id." });
  }

  const vehicle = await getOwnedVehicle(context.supabase, context.profile.id, vehicleId);
  if (!vehicle) {
    redirectWithStatus("/dashboard", { error: "Vehicle not found." });
  }

  const { error: deleteError } = await context.supabase
    .from("vehicles")
    .delete()
    .eq("id", vehicleId)
    .eq("profile_id", context.profile.id);

  if (deleteError) {
    redirectWithLoggedSafeError({
      action: "delete_vehicle",
      error: deleteError,
      redirectPath: `/dashboard/vehicles/${vehicleId}/edit`,
      messageKey: "vehicleDeleteFailed",
      userId: context.userId,
      context: { vehicleId },
    });
  }

  revalidateDashboardPaths(vehicleId, context.profile.username);
  redirectWithStatus("/dashboard", { status: "Vehicle deleted." });
}

export async function createModAction(formData: FormData) {
  const vehicleId = toSingleValue(formData.get("vehicle_id"));
  const redirectPath = toSafeRedirectPath(
    formData.get("redirect_to"),
    `/dashboard/vehicles/${vehicleId}/edit`
  );
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "createMod", redirectPath);

  if (!isUuid(vehicleId)) {
    redirectWithStatus(redirectPath, { error: "Invalid vehicle id." });
  }

  const vehicle = await getOwnedVehicle(context.supabase, context.profile.id, vehicleId);
  if (!vehicle) {
    redirectWithStatus(redirectPath, { error: "Vehicle not found." });
  }

  await enforceModLimitOrRedirect(context, vehicleId, redirectPath);

  const modImageFile = getUploadFile(formData, "mod_image_file", redirectPath);
  if (modImageFile) {
    await enforceImageLimitOrRedirect(context, redirectPath);
  }

  const title = toSingleValue(formData.get("title"));
  const category = toOptionalText(formData.get("category"));
  const costCents = parseOptionalCostCentsOrRedirect(formData.get("cost"), redirectPath);
  const notes = toOptionalText(formData.get("notes"));
  const installedOn = parseOptionalDateOrRedirect(
    formData.get("installed_on"),
    redirectPath
  );

  if (!title) {
    redirectWithStatus(redirectPath, { error: "Mod title is required." });
  }
  validateMaxLengthOrRedirect(title, 80, "Mod title", redirectPath);
  validateMaxLengthOrRedirect(category, 40, "Category", redirectPath);

  const { data: lastMod, error: lastModError } = await context.supabase
    .from("mods")
    .select("sort_order")
    .eq("vehicle_id", vehicleId)
    .order("sort_order", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastModError) {
    redirectWithLoggedSafeError({
      action: "create_mod_prepare_sort",
      error: lastModError,
      redirectPath,
      messageKey: "modSortPrepareFailed",
      userId: context.userId,
      context: { vehicleId },
    });
  }

  const nextSortOrder = (lastMod?.sort_order ?? -1) + 1;
  const { data: mod, error: createError } = await context.supabase
    .from("mods")
    .insert({
      vehicle_id: vehicleId,
      title,
      category,
      cost_cents: costCents,
      notes,
      installed_on: installedOn,
      sort_order: nextSortOrder,
    })
    .select("id")
    .single();

  if (createError || !mod) {
    redirectWithLoggedSafeError({
      action: "create_mod",
      error: createError ?? new Error("Mod insert returned no row."),
      redirectPath,
      messageKey: "modCreateFailed",
      userId: context.userId,
      context: { vehicleId },
    });
  }

  if (modImageFile) {
    const path = await uploadFile(
      context.supabase,
      modImageFile,
      `mods/${mod.id}`,
      redirectPath
    );
    const { data: lastImage, error: imageSortError } = await context.supabase
      .from("images")
      .select("sort_order")
      .eq("mod_id", mod.id)
      .order("sort_order", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (imageSortError) {
      redirectWithLoggedSafeError({
        action: "create_mod_prepare_image_sort",
        error: imageSortError,
        redirectPath,
        messageKey: "modCreateImageFailed",
        userId: context.userId,
        context: { vehicleId, modId: mod.id },
      });
    }

    const { error: imageInsertError } = await context.supabase.from("images").insert({
      profile_id: context.userId,
      vehicle_id: null,
      mod_id: mod.id,
      storage_bucket: BUCKET_NAME,
      storage_path: path,
      sort_order: (lastImage?.sort_order ?? -1) + 1,
    });

    if (imageInsertError) {
      redirectWithLoggedSafeError({
        action: "create_mod_insert_image",
        error: imageInsertError,
        redirectPath,
        messageKey: "modCreateImageFailed",
        userId: context.userId,
        context: { vehicleId, modId: mod.id },
      });
    }
  }

  revalidateDashboardPaths(vehicleId, context.profile.username);
  redirectWithStatus(redirectPath, { status: "Mod created." });
}

export async function updateModAction(formData: FormData) {
  const vehicleId = toSingleValue(formData.get("vehicle_id"));
  const modId = toSingleValue(formData.get("mod_id"));
  const redirectPath = toSafeRedirectPath(
    formData.get("redirect_to"),
    `/dashboard/vehicles/${vehicleId}/edit`
  );
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "updateMod", redirectPath);

  if (!isUuid(vehicleId) || !isUuid(modId)) {
    redirectWithStatus(redirectPath, { error: "Invalid mod or vehicle id." });
  }

  const vehicle = await getOwnedVehicle(context.supabase, context.profile.id, vehicleId);
  if (!vehicle) {
    redirectWithStatus(redirectPath, { error: "Vehicle not found." });
  }

  const mod = await getOwnedMod(context.supabase, vehicleId, modId);
  if (!mod) {
    redirectWithStatus(redirectPath, { error: "Mod not found." });
  }

  const title = toSingleValue(formData.get("title"));
  const category = toOptionalText(formData.get("category"));
  const costCents = parseOptionalCostCentsOrRedirect(formData.get("cost"), redirectPath);
  const notes = toOptionalText(formData.get("notes"));
  const installedOn = parseOptionalDateOrRedirect(
    formData.get("installed_on"),
    redirectPath
  );
  const modImageFile = getUploadFile(formData, "mod_image_file", redirectPath);

  if (!title) {
    redirectWithStatus(redirectPath, { error: "Mod title is required." });
  }
  validateMaxLengthOrRedirect(title, 80, "Mod title", redirectPath);
  validateMaxLengthOrRedirect(category, 40, "Category", redirectPath);

  const { error: updateError } = await context.supabase
    .from("mods")
    .update({
      title,
      category,
      cost_cents: costCents,
      notes,
      installed_on: installedOn,
    })
    .eq("id", modId)
    .eq("vehicle_id", vehicleId);

  if (updateError) {
    redirectWithLoggedSafeError({
      action: "update_mod",
      error: updateError,
      redirectPath,
      messageKey: "modUpdateFailed",
      userId: context.userId,
      context: { vehicleId, modId },
    });
  }

  if (modImageFile) {
    await enforceImageLimitOrRedirect(context, redirectPath);
    const path = await uploadFile(
      context.supabase,
      modImageFile,
      `mods/${modId}`,
      redirectPath
    );
    const { data: lastImage, error: imageSortError } = await context.supabase
      .from("images")
      .select("sort_order")
      .eq("mod_id", modId)
      .order("sort_order", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (imageSortError) {
      redirectWithLoggedSafeError({
        action: "update_mod_prepare_image_sort",
        error: imageSortError,
        redirectPath,
        messageKey: "modUpdateImageFailed",
        userId: context.userId,
        context: { vehicleId, modId },
      });
    }

    const { error: imageInsertError } = await context.supabase.from("images").insert({
      profile_id: context.userId,
      vehicle_id: null,
      mod_id: modId,
      storage_bucket: BUCKET_NAME,
      storage_path: path,
      sort_order: (lastImage?.sort_order ?? -1) + 1,
    });

    if (imageInsertError) {
      redirectWithLoggedSafeError({
        action: "update_mod_insert_image",
        error: imageInsertError,
        redirectPath,
        messageKey: "modUpdateImageFailed",
        userId: context.userId,
        context: { vehicleId, modId },
      });
    }
  }

  revalidateDashboardPaths(vehicleId, context.profile.username);
  redirectWithStatus(redirectPath, { status: "Mod updated." });
}

export async function moveModAction(formData: FormData) {
  const vehicleId = toSingleValue(formData.get("vehicle_id"));
  const modId = toSingleValue(formData.get("mod_id"));
  const directionRaw = toSingleValue(formData.get("direction"));
  const redirectPath = toSafeRedirectPath(
    formData.get("redirect_to"),
    `/dashboard/vehicles/${vehicleId}/edit`
  );
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "moveMod", redirectPath);

  if (!isUuid(vehicleId) || !isUuid(modId)) {
    redirectWithStatus(redirectPath, { error: "Invalid mod or vehicle id." });
  }
  if (directionRaw !== "up" && directionRaw !== "down") {
    redirectWithStatus(redirectPath, { error: "Invalid move direction." });
  }
  const direction: Direction = directionRaw;

  const vehicle = await getOwnedVehicle(context.supabase, context.profile.id, vehicleId);
  if (!vehicle) {
    redirectWithStatus(redirectPath, { error: "Vehicle not found." });
  }

  const { data: reorderResult, error: reorderError } = await context.supabase.rpc(
    "reorder_mod_swap",
    {
      p_vehicle_id: vehicleId,
      p_mod_id: modId,
      p_direction: direction,
    }
  );

  if (reorderError) {
    redirectWithLoggedSafeError({
      action: "move_mod_swap_rpc",
      error: reorderError,
      redirectPath,
      messageKey: "modReorderFailed",
      userId: context.userId,
      context: { vehicleId, modId, direction },
    });
  }

  const outcome = parseReorderSwapOutcome(reorderResult);
  if (!outcome) {
    redirectWithLoggedSafeError({
      action: "move_mod_swap_parse_result",
      error: new Error("Unexpected reorder_mod_swap response shape."),
      redirectPath,
      messageKey: "modReorderFailed",
      userId: context.userId,
      context: { vehicleId, modId, direction, resultType: typeof reorderResult },
    });
  }

  if (outcome === "not_found") {
    redirectWithStatus(redirectPath, { error: "Mod not found." });
  }

  if (outcome === "boundary") {
    redirectWithStatus(redirectPath, { status: "Mod is already at this position." });
  }

  revalidateDashboardPaths(vehicleId, context.profile.username);
  redirectWithStatus(redirectPath, { status: "Mod reordered." });
}

export async function deleteModAction(formData: FormData) {
  const vehicleId = toSingleValue(formData.get("vehicle_id"));
  const modId = toSingleValue(formData.get("mod_id"));
  const redirectPath = toSafeRedirectPath(
    formData.get("redirect_to"),
    `/dashboard/vehicles/${vehicleId}/edit`
  );
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "deleteMod", redirectPath);

  if (!isUuid(vehicleId) || !isUuid(modId)) {
    redirectWithStatus(redirectPath, { error: "Invalid mod or vehicle id." });
  }

  const vehicle = await getOwnedVehicle(context.supabase, context.profile.id, vehicleId);
  if (!vehicle) {
    redirectWithStatus(redirectPath, { error: "Vehicle not found." });
  }

  const mod = await getOwnedMod(context.supabase, vehicleId, modId);
  if (!mod) {
    redirectWithStatus(redirectPath, { error: "Mod not found." });
  }

  const { error: deleteError } = await context.supabase
    .from("mods")
    .delete()
    .eq("id", modId)
    .eq("vehicle_id", vehicleId);

  if (deleteError) {
    redirectWithLoggedSafeError({
      action: "delete_mod",
      error: deleteError,
      redirectPath,
      messageKey: "modDeleteFailed",
      userId: context.userId,
      context: { vehicleId, modId },
    });
  }

  revalidateDashboardPaths(vehicleId, context.profile.username);
  redirectWithStatus(redirectPath, { status: "Mod deleted." });
}

export async function uploadImageAction(formData: FormData) {
  const parentType = toSingleValue(formData.get("parent_type"));
  const parentId = toSingleValue(formData.get("parent_id"));
  const vehicleIdFromForm = toSingleValue(formData.get("vehicle_id"));
  const redirectPath = toSafeRedirectPath(
    formData.get("redirect_to"),
    vehicleIdFromForm ? `/dashboard/vehicles/${vehicleIdFromForm}/edit` : "/dashboard"
  );
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "uploadImage", redirectPath);
  const file = getUploadFile(formData, "image_file", redirectPath);
  const caption = toOptionalText(formData.get("caption"));
  validateMaxLengthOrRedirect(caption, 120, "Caption", redirectPath);

  if (!file) {
    redirectWithStatus(redirectPath, { error: "Choose an image to upload." });
  }
  if (!isUuid(parentId)) {
    redirectWithStatus(redirectPath, { error: "Invalid image parent id." });
  }
  if (parentType !== "vehicle" && parentType !== "mod") {
    redirectWithStatus(redirectPath, { error: "Invalid image parent type." });
  }

  await enforceImageLimitOrRedirect(context, redirectPath);

  let vehicleIdForRevalidate = vehicleIdFromForm;
  if (parentType === "vehicle") {
    const vehicle = await getOwnedVehicle(context.supabase, context.profile.id, parentId);
    if (!vehicle) {
      redirectWithStatus(redirectPath, { error: "Vehicle not found for image upload." });
    }
    vehicleIdForRevalidate = parentId;
  } else {
    const { data: mod, error: modError } = await context.supabase
      .from("mods")
      .select("id, vehicle_id")
      .eq("id", parentId)
      .maybeSingle();

    if (modError || !mod) {
      redirectWithLoggedSafeError({
        action: "upload_image_load_mod",
        error: modError ?? new Error("Mod not found for image upload."),
        redirectPath,
        messageKey: "modLookupForImageUploadFailed",
        userId: context.userId,
        context: { parentId, parentType },
      });
    }

    const vehicle = await getOwnedVehicle(context.supabase, context.profile.id, mod.vehicle_id);
    if (!vehicle) {
      redirectWithStatus(redirectPath, { error: "Mod does not belong to your vehicle." });
    }

    vehicleIdForRevalidate = mod.vehicle_id;
  }

  const prefix = parentType === "vehicle" ? `vehicles/${parentId}` : `mods/${parentId}`;
  const storagePath = await uploadFile(context.supabase, file, prefix, redirectPath);

  const sortColumn = parentType === "vehicle" ? "vehicle_id" : "mod_id";
  const { data: lastImage, error: lastImageError } = await context.supabase
    .from("images")
    .select("sort_order")
    .eq(sortColumn, parentId)
    .order("sort_order", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastImageError) {
    redirectWithLoggedSafeError({
      action: "upload_image_prepare_sort",
      error: lastImageError,
      redirectPath,
      messageKey: "imageUploadMetadataFailed",
      userId: context.userId,
      context: { parentId, parentType },
    });
  }

  const { error: insertError } = await context.supabase.from("images").insert({
    profile_id: context.userId,
    vehicle_id: parentType === "vehicle" ? parentId : null,
    mod_id: parentType === "mod" ? parentId : null,
    storage_bucket: BUCKET_NAME,
    storage_path: storagePath,
    caption,
    sort_order: (lastImage?.sort_order ?? -1) + 1,
  });

  if (insertError) {
    redirectWithLoggedSafeError({
      action: "upload_image_insert_metadata",
      error: insertError,
      redirectPath,
      messageKey: "imageSaveFailed",
      userId: context.userId,
      context: { parentId, parentType },
    });
  }

  revalidateDashboardPaths(vehicleIdForRevalidate, context.profile.username);
  redirectWithStatus(redirectPath, { status: "Image uploaded." });
}

export async function deleteImageAction(formData: FormData) {
  const imageId = toSingleValue(formData.get("image_id"));
  const vehicleId = toSingleValue(formData.get("vehicle_id"));
  const redirectPath = toSafeRedirectPath(
    formData.get("redirect_to"),
    vehicleId ? `/dashboard/vehicles/${vehicleId}/edit` : "/dashboard"
  );
  const context = await getAuthContext();
  await enforceRateLimitOrRedirect(context, "deleteImage", redirectPath);

  if (!isUuid(imageId)) {
    redirectWithStatus(redirectPath, { error: "Invalid image id." });
  }

  const { data: image, error: imageError } = await context.supabase
    .from("images")
    .select("id, storage_path, storage_bucket")
    .eq("id", imageId)
    .eq("profile_id", context.profile.id)
    .maybeSingle();

  if (imageError || !image) {
    redirectWithLoggedSafeError({
      action: "delete_image_load",
      error: imageError ?? new Error("Image not found."),
      redirectPath,
      messageKey: "imageLookupFailed",
      userId: context.userId,
      context: { imageId },
    });
  }

  const { error: deleteError } = await context.supabase
    .from("images")
    .delete()
    .eq("id", imageId)
    .eq("profile_id", context.profile.id);

  if (deleteError) {
    redirectWithLoggedSafeError({
      action: "delete_image",
      error: deleteError,
      redirectPath,
      messageKey: "imageDeleteFailed",
      userId: context.userId,
      context: { imageId },
    });
  }

  if (image.storage_path) {
    await context.supabase.storage
      .from(image.storage_bucket || BUCKET_NAME)
      .remove([image.storage_path]);
  }

  revalidateDashboardPaths(vehicleId || undefined, context.profile.username);
  redirectWithStatus(redirectPath, { status: "Image deleted." });
}
