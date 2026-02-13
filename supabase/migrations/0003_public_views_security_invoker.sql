begin;

create or replace view public.public_profiles
with (security_invoker = true)
as
select
  p.username,
  p.display_name,
  p.bio,
  p.avatar_image_path,
  p.created_at
from public.profiles p
where p.username is not null;

create or replace view public.public_vehicles
with (security_invoker = true)
as
select
  v.id,
  v.profile_id,
  v.name,
  v.year,
  v.make,
  v.model,
  v.trim,
  v.hero_image_path,
  v.sort_order,
  v.created_at
from public.vehicles v
where v.is_public = true
  and exists (
    select 1
    from public.profiles p
    where p.id = v.profile_id
      and p.username is not null
  );

create or replace view public.public_mods
with (security_invoker = true)
as
select
  m.id,
  m.vehicle_id,
  m.title,
  m.category,
  m.cost_cents,
  m.notes,
  m.installed_on,
  m.sort_order,
  m.created_at
from public.mods m
where exists (
  select 1
  from public.vehicles v
  join public.profiles p on p.id = v.profile_id
  where v.id = m.vehicle_id
    and v.is_public = true
    and p.username is not null
);

create or replace view public.public_images
with (security_invoker = true)
as
select
  i.id,
  i.vehicle_id,
  i.mod_id,
  i.storage_bucket,
  i.storage_path,
  i.caption,
  i.sort_order,
  i.created_at
from public.images i
where (
  i.vehicle_id is not null
  and exists (
    select 1
    from public.vehicles v
    join public.profiles p on p.id = v.profile_id
    where v.id = i.vehicle_id
      and v.is_public = true
      and p.username is not null
  )
)
or (
  i.mod_id is not null
  and exists (
    select 1
    from public.mods m
    join public.vehicles v on v.id = m.vehicle_id
    join public.profiles p on p.id = v.profile_id
    where m.id = i.mod_id
      and v.is_public = true
      and p.username is not null
  )
);

revoke select on public.profiles, public.vehicles, public.mods, public.images from anon;

grant select (username, display_name, bio, avatar_image_path, created_at)
on public.profiles to anon;

grant select (id, profile_id, name, year, make, model, trim, hero_image_path, sort_order, created_at, is_public)
on public.vehicles to anon;

grant select (id, vehicle_id, title, category, cost_cents, notes, installed_on, sort_order, created_at)
on public.mods to anon;

grant select (id, vehicle_id, mod_id, storage_bucket, storage_path, caption, sort_order, created_at)
on public.images to anon;

grant select on public.public_profiles, public.public_vehicles, public.public_mods, public.public_images to anon;

commit;
