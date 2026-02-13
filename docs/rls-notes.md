# RLS Notes

## Why `images` ownership was a hole
The old `images_owner_insert`/`images_owner_update` checks only required:
- `images.profile_id = auth.uid()`

That meant a malicious user could submit:
- their own `profile_id`
- someone else's `vehicle_id` or `mod_id`

and still pass policy checks, attaching images to content they do not own.

## Published profile definition
For MVP, a profile is considered **published** when:
- `profiles.username is not null`

If `username` is `NULL`, the profile is treated as unpublished and its public vehicles/mods/images should not be visible through public policies.

## Policy responsibilities (plain English)
- `profiles_public_select`:
  - Public can read profiles that have a non-null username.
- `vehicles_public_select`:
  - Public can read a vehicle only when `is_public = true` **and** the owning profile has a non-null username.
- `mods_public_select`:
  - Public can read a mod only when its parent vehicle is public **and** that vehicle's profile has a non-null username.
- `images_public_select`:
  - Public can read vehicle images only when the parent vehicle is public **and** the vehicle's profile has a non-null username.
  - Public can read mod images only when the parent mod's vehicle is public **and** that vehicle's profile has a non-null username.
- `images_owner_select` / `images_owner_insert` / `images_owner_update` / `images_owner_delete`:
  - Authenticated user must have `images.profile_id = auth.uid()`.
  - If image points to a vehicle, that vehicle must belong to `auth.uid()`.
  - If image points to a mod, that mod's vehicle must belong to `auth.uid()`.
  - This closes the cross-user parent-linking hole.