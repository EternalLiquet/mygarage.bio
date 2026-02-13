# Backend MVP (Supabase + Next.js)

## Scope
This MVP backend covers only:
- profiles
- vehicles
- mods
- images

Auth users are in `auth.users`, and `profiles.id` maps 1:1 to `auth.users.id`.

## Migration
Initial schema and RLS are in:
- `supabase/migrations/0001_init.sql`

Highlights:
- UUID primary keys
- FK relationships with `on delete cascade`
- `created_at` on all tables
- `updated_at` on `profiles`, `vehicles`, `mods` (managed by trigger)
- `images` has a strict parent check: exactly one of `vehicle_id` or `mod_id`
- Username uniqueness is case-insensitive (`unique index on lower(username)`)

## RLS intent
- Owner access: authenticated user (`auth.uid()`) can CRUD only their own profile/vehicles/mods/images.
- Public access:
  - Profiles: selectable when `username` is set.
  - Vehicles: selectable when `is_public = true`.
  - Mods: selectable when linked to a public vehicle.
  - Images: selectable when linked (directly or via mod) to a public vehicle.

Owner checks are enforced by RLS policies in SQL, not by application-side ownership logic.

## Storage path conventions
No storage policies are included yet. The app should write paths following:
- `avatars/{profile_id}/{uuid}.jpg`
- `vehicles/{vehicle_id}/{uuid}.jpg`
- `mods/{mod_id}/{uuid}.jpg`

## Query utilities
Typed query helpers live in:
- `src/lib/db/types.ts`
- `src/lib/db/queries.ts`

Notes:
- Query utilities use `@supabase/supabase-js`.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are required.
- Owner-scoped helpers require a user-authenticated Supabase client so RLS can enforce ownership.
- `src/lib/db/queries.ts` includes a TODO fallback env (`SUPABASE_USER_ACCESS_TOKEN`) for local scripts.

## Cost-Abuse Defenses
- Public routes now use ISR (`revalidate = 300`) on:
  - `src/app/u/[username]/page.tsx`
  - `src/app/u/[username]/v/[vehicleId]/page.tsx`
- Public image URL resolution is optimized in `src/lib/media.ts`:
  - Signs URLs only when the bucket is private.
  - Caches bucket visibility checks and signed URLs in-memory.
  - Supports batched URL resolution to avoid N signed-url calls per render.
  - Uses shorter signed URL TTL by default (10 minutes).
- Dashboard mutation server actions are rate-limited per user + IP in:
  - `src/app/dashboard/actions.ts`
- Durable distributed rate limiting is enforced in Postgres via:
  - `supabase/migrations/0006_durable_rate_limit.sql`
  - `public.rate_limit_buckets`
  - `public.rate_limit_consume(...)` (atomic fixed-window consume)
  - `public.rate_limit_cleanup_expired(...)` (cheap periodic cleanup)

## Auth Start Hardening
- Login initiation moved server-side to:
  - `src/app/auth/start/otp/route.ts`
  - `src/app/auth/start/oauth/route.ts`
- Limits are applied before calling Supabase auth:
  - OTP: IP + browser identifier + email identifier
  - OAuth start: IP + browser identifier
- Browser identifier is stored as secure HTTP-only cookie `auth_start_id`.

## Storage Hardening
- Migration `supabase/migrations/0005_storage_mygarage_policies.sql` adds strict policies for `storage.objects` in bucket `mygarage`:
  - Sets `mygarage` bucket to private (`public = false`) so read rules are enforceable.
  - Anonymous users: read-only for objects referenced by public profile/vehicle/image views.
  - Authenticated users: write/delete only to owner-scoped paths:
    - `avatars/{uid}/...`
    - `vehicles/{vehicleId}/...` when vehicle belongs to the user
    - `mods/{modId}/...` when mod belongs to the user (via owned vehicle)

## Env / Config Notes
- `SUPABASE_SERVICE_ROLE_KEY` is required for:
  - signed public image URLs when `mygarage` is private
  - durable Postgres-backed rate limiting
- Optional: `PUBLIC_IMAGE_SIGNED_URL_TTL_SECONDS` to tune signed URL lifetime (minimum accepted: 30 seconds).
- `NEXT_PUBLIC_SITE_URL` should be set in production for absolute canonical/OpenGraph URLs.
- If your Supabase project has older broad `storage.objects` policies, remove or tighten them so they do not allow extra access to `mygarage`.
