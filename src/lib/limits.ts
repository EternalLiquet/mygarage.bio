export const FREE_TIER_LIMITS = {
  vehicles: 1,
  modsPerVehicle: 10,
  imagesPerProfile: 10,
} as const;

export type LimitKey = "vehicles" | "mods" | "images";

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_]{3,30}$/.test(username);
}
