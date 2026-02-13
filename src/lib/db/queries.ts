import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type {
  ImageInsert,
  ImageRow,
  ModInsert,
  ModRow,
  ModUpdate,
  ProfileInsert,
  ProfileRow,
  ProfileUpdate,
  UUID,
  VehicleInsert,
  VehicleRow,
  VehicleUpdate,
} from "./types";

type DbClient = SupabaseClient;
export type ImageParentType = "vehicle" | "mod";

export type UpsertOwnerProfilePayload = ProfileUpdate;
export type CreateVehiclePayload = Omit<VehicleInsert, "profile_id">;
export type UpdateVehiclePayload = VehicleUpdate;
export type CreateModPayload = Omit<ModInsert, "vehicle_id">;
export type UpdateModPayload = ModUpdate;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OWNER_TOKEN_ENV = "SUPABASE_USER_ACCESS_TOKEN"; // TODO: Replace with request-scoped auth in App Router.

function createDbClient(accessToken?: string): DbClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing Supabase env vars. TODO: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getPublicClient(client?: DbClient): DbClient {
  return client ?? createDbClient();
}

function getOwnerClient(client?: DbClient): DbClient {
  if (client) return client;

  const accessToken = process.env[OWNER_TOKEN_ENV];
  if (!accessToken) {
    throw new Error(
      `Missing authenticated Supabase client. Pass a user-scoped client or set TODO env ${OWNER_TOKEN_ENV} for local scripts.`
    );
  }

  return createDbClient(accessToken);
}

function throwPostgrestError(context: string, error: PostgrestError): never {
  const rlsHint =
    error.code === "42501"
      ? " RLS denied the operation. Ensure this runs with a user-scoped client."
      : "";
  throw new Error(`${context}: ${error.message}.${rlsHint}`);
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export type PublicProfile = {
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_image_path: string | null;
  created_at: string;
};

export type PublicVehicle = {
  id: UUID;
  profile_id: UUID;
  name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  hero_image_path: string | null;
  sort_order: number;
  created_at: string;
};

export type PublicMod = {
  id: UUID;
  vehicle_id: UUID;
  title: string;
  category: string | null;
  cost_cents: number | null;
  notes: string | null;
  installed_on: string | null;
  sort_order: number;
  created_at: string;
};

export type PublicImage = {
  id: UUID;
  vehicle_id: UUID | null;
  mod_id: UUID | null;
  storage_bucket: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
};

const PUBLIC_PROFILE_COLUMNS = "username, display_name, bio, avatar_image_path, created_at";
const PUBLIC_VEHICLE_COLUMNS =
  "id, profile_id, name, year, make, model, trim, hero_image_path, sort_order, created_at";
const PUBLIC_MOD_COLUMNS =
  "id, vehicle_id, title, category, cost_cents, notes, installed_on, sort_order, created_at";
const PUBLIC_IMAGE_COLUMNS =
  "id, vehicle_id, mod_id, storage_bucket, storage_path, caption, sort_order, created_at";

type PublicVehicleWithProfileJoin = PublicVehicle & {
  profiles?: { username: string } | Array<{ username: string }> | null;
};

function stripVehicleProfileJoin(row: PublicVehicleWithProfileJoin): PublicVehicle {
  const {
    id,
    profile_id,
    name,
    year,
    make,
    model,
    trim,
    hero_image_path,
    sort_order,
    created_at,
  } = row;

  return {
    id,
    profile_id,
    name,
    year,
    make,
    model,
    trim,
    hero_image_path,
    sort_order,
    created_at,
  };
}

export async function getPublicProfile(
  username: string,
  client?: DbClient
): Promise<PublicProfile | null> {
  const db = getPublicClient(client);
  const normalizedUsername = normalizeUsername(username);

  const { data, error } = await db
    .from("public_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("username", normalizedUsername)
    .maybeSingle();

  if (error) throwPostgrestError("Failed to fetch public profile", error);
  return data as PublicProfile | null;
}

export async function getPublicVehicles(
  input: { username?: string; profileId?: UUID },
  client?: DbClient
): Promise<PublicVehicle[]> {
  const db = getPublicClient(client);

  if (input.profileId) {
    const { data, error } = await db
      .from("public_vehicles")
      .select(PUBLIC_VEHICLE_COLUMNS)
      .eq("profile_id", input.profileId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throwPostgrestError("Failed to fetch public vehicles", error);
    return (data ?? []) as PublicVehicle[];
  }

  const normalizedUsername = normalizeUsername(input.username ?? "");
  if (!normalizedUsername) {
    return [];
  }

  const { data, error } = await db
    .from("public_vehicles")
    .select(`${PUBLIC_VEHICLE_COLUMNS}, profiles!inner(username)`)
    .eq("profiles.username", normalizedUsername)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throwPostgrestError("Failed to fetch public vehicles", error);
  return ((data ?? []) as PublicVehicleWithProfileJoin[]).map(stripVehicleProfileJoin);
}

export async function getPublicVehicle(
  vehicleId: UUID,
  client?: DbClient
): Promise<PublicVehicle | null> {
  const db = getPublicClient(client);

  const { data, error } = await db
    .from("public_vehicles")
    .select(PUBLIC_VEHICLE_COLUMNS)
    .eq("id", vehicleId)
    .maybeSingle();

  if (error) throwPostgrestError("Failed to fetch public vehicle", error);
  return data as PublicVehicle | null;
}

export async function getPublicModCountsByVehicleIds(
  vehicleIds: UUID[],
  client?: DbClient
): Promise<Record<UUID, number>> {
  if (vehicleIds.length === 0) {
    return {};
  }

  const db = getPublicClient(client);
  const { data, error } = await db
    .from("public_mods")
    .select("vehicle_id")
    .in("vehicle_id", vehicleIds);

  if (error) throwPostgrestError("Failed to fetch mod counts", error);

  const counts: Record<UUID, number> = {};
  for (const vehicleId of vehicleIds) {
    counts[vehicleId] = 0;
  }

  for (const row of data ?? []) {
    counts[row.vehicle_id] = (counts[row.vehicle_id] ?? 0) + 1;
  }

  return counts;
}

export async function getPublicMods(
  vehicleId: UUID,
  client?: DbClient
): Promise<PublicMod[]> {
  const db = getPublicClient(client);

  const { data, error } = await db
    .from("public_mods")
    .select(PUBLIC_MOD_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throwPostgrestError("Failed to fetch public mods", error);
  return (data ?? []) as PublicMod[];
}

export async function getPublicImagesForVehicle(
  vehicleId: UUID,
  client?: DbClient
): Promise<PublicImage[]> {
  const db = getPublicClient(client);

  const { data, error } = await db
    .from("public_images")
    .select(PUBLIC_IMAGE_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throwPostgrestError("Failed to fetch vehicle images", error);
  return (data ?? []) as PublicImage[];
}

export async function getPublicImagesForMods(
  vehicleId: UUID,
  client?: DbClient
): Promise<PublicImage[]> {
  const mods = await getPublicMods(vehicleId, client);
  return getPublicImagesForModIds(mods.map((mod) => mod.id), client);
}

export async function getPublicImagesForModIds(
  modIds: UUID[],
  client?: DbClient
): Promise<PublicImage[]> {
  if (modIds.length === 0) {
    return [];
  }

  const db = getPublicClient(client);

  const { data, error } = await db
    .from("public_images")
    .select(PUBLIC_IMAGE_COLUMNS)
    .in("mod_id", modIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throwPostgrestError("Failed to fetch mod images", error);
  return (data ?? []) as PublicImage[];
}

export async function getOwnerProfile(
  userId: UUID,
  client?: DbClient
): Promise<ProfileRow | null> {
  const db = getOwnerClient(client);

  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throwPostgrestError("Failed to fetch owner profile", error);
  return data;
}

export async function upsertOwnerProfile(
  userId: UUID,
  payload: UpsertOwnerProfilePayload,
  client?: DbClient
): Promise<ProfileRow> {
  const db = getOwnerClient(client);
  const row: ProfileInsert = {
    id: userId,
    ...payload,
    username:
      typeof payload.username === "string"
        ? normalizeUsername(payload.username)
        : payload.username,
  };

  const { data, error } = await db
    .from("profiles")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();

  if (error) throwPostgrestError("Failed to upsert owner profile", error);
  return data;
}

export async function createVehicle(
  userId: UUID,
  payload: CreateVehiclePayload,
  client?: DbClient
): Promise<VehicleRow> {
  const db = getOwnerClient(client);
  const insertPayload: VehicleInsert = {
    profile_id: userId,
    ...payload,
  };

  const { data, error } = await db
    .from("vehicles")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) throwPostgrestError("Failed to create vehicle", error);
  return data;
}

export async function updateVehicle(
  userId: UUID,
  vehicleId: UUID,
  payload: UpdateVehiclePayload,
  client?: DbClient
): Promise<VehicleRow> {
  void userId;
  const db = getOwnerClient(client);

  const { data, error } = await db
    .from("vehicles")
    .update(payload)
    .eq("id", vehicleId)
    .select("*")
    .maybeSingle();

  if (error) throwPostgrestError("Failed to update vehicle", error);
  if (!data) {
    throw new Error("Vehicle not found or not owned by the current user.");
  }

  return data;
}

export async function deleteVehicle(
  userId: UUID,
  vehicleId: UUID,
  client?: DbClient
): Promise<boolean> {
  void userId;
  const db = getOwnerClient(client);

  const { data, error } = await db
    .from("vehicles")
    .delete()
    .eq("id", vehicleId)
    .select("id")
    .maybeSingle();

  if (error) throwPostgrestError("Failed to delete vehicle", error);
  return Boolean(data);
}

export async function createMod(
  userId: UUID,
  vehicleId: UUID,
  payload: CreateModPayload,
  client?: DbClient
): Promise<ModRow> {
  void userId;
  const db = getOwnerClient(client);
  const insertPayload: ModInsert = {
    vehicle_id: vehicleId,
    ...payload,
  };

  const { data, error } = await db
    .from("mods")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) throwPostgrestError("Failed to create mod", error);
  return data;
}

export async function updateMod(
  userId: UUID,
  modId: UUID,
  payload: UpdateModPayload,
  client?: DbClient
): Promise<ModRow> {
  void userId;
  const db = getOwnerClient(client);

  const { data, error } = await db
    .from("mods")
    .update(payload)
    .eq("id", modId)
    .select("*")
    .maybeSingle();

  if (error) throwPostgrestError("Failed to update mod", error);
  if (!data) {
    throw new Error("Mod not found or not owned by the current user.");
  }

  return data;
}

export async function deleteMod(
  userId: UUID,
  modId: UUID,
  client?: DbClient
): Promise<boolean> {
  void userId;
  const db = getOwnerClient(client);

  const { data, error } = await db
    .from("mods")
    .delete()
    .eq("id", modId)
    .select("id")
    .maybeSingle();

  if (error) throwPostgrestError("Failed to delete mod", error);
  return Boolean(data);
}

export async function createImage(
  userId: UUID,
  parentType: ImageParentType,
  parentId: UUID,
  storagePath: string,
  caption?: string | null,
  client?: DbClient
): Promise<ImageRow> {
  const db = getOwnerClient(client);
  const insertPayload: ImageInsert = {
    profile_id: userId,
    storage_path: storagePath,
    caption: caption ?? null,
    ...(parentType === "vehicle"
      ? { vehicle_id: parentId, mod_id: null }
      : { vehicle_id: null, mod_id: parentId }),
  };

  const { data, error } = await db
    .from("images")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) throwPostgrestError("Failed to create image", error);
  return data;
}

export async function deleteImage(
  userId: UUID,
  imageId: UUID,
  client?: DbClient
): Promise<boolean> {
  void userId;
  const db = getOwnerClient(client);

  const { data, error } = await db
    .from("images")
    .delete()
    .eq("id", imageId)
    .select("id")
    .maybeSingle();

  if (error) throwPostgrestError("Failed to delete image", error);
  return Boolean(data);
}
