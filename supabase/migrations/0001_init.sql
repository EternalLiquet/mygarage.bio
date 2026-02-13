-- MyGarage.bio MVP schema
-- Storage path conventions (documentation only, storage policies are out of scope for this migration):
--   avatars/{profile_id}/{uuid}.jpg
--   vehicles/{vehicle_id}/{uuid}.jpg
--   mods/{mod_id}/{uuid}.jpg

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  display_name text,
  bio text,
  avatar_image_path text,
  is_pro boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_username_not_blank check (username is null or btrim(username) <> ''),
  constraint profiles_username_lowercase check (username is null or username = lower(username))
);
-- username is nullable for onboarding; NULL means the profile is unpublished.
comment on column public.profiles.username is
  'Public handle for published profiles. NULL means unpublished profile.';

create unique index if not exists profiles_username_unique_ci_idx
  on public.profiles (lower(username))
  where username is not null;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  year integer,
  make text,
  model text,
  trim text,
  hero_image_path text,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists vehicles_profile_id_idx on public.vehicles (profile_id);
create index if not exists vehicles_is_public_idx on public.vehicles (is_public);
create index if not exists vehicles_profile_sort_idx on public.vehicles (profile_id, sort_order, created_at);

create table if not exists public.mods (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  title text not null,
  category text,
  cost_cents integer,
  notes text,
  installed_on date,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mods_cost_cents_non_negative check (cost_cents is null or cost_cents >= 0)
);

create index if not exists mods_vehicle_id_idx on public.mods (vehicle_id);
create index if not exists mods_vehicle_sort_idx on public.mods (vehicle_id, sort_order, created_at);

create table if not exists public.images (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete cascade,
  mod_id uuid references public.mods (id) on delete cascade,
  storage_bucket text not null default 'mygarage',
  storage_path text not null,
  caption text,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint images_exactly_one_parent check (
    (vehicle_id is not null and mod_id is null) or
    (vehicle_id is null and mod_id is not null)
  ),
  constraint images_storage_path_not_blank check (btrim(storage_path) <> '')
);

create index if not exists images_profile_id_idx on public.images (profile_id);
create index if not exists images_vehicle_id_idx on public.images (vehicle_id) where vehicle_id is not null;
create index if not exists images_mod_id_idx on public.images (mod_id) where mod_id is not null;
create index if not exists images_vehicle_sort_idx on public.images (vehicle_id, sort_order, created_at) where vehicle_id is not null;
create index if not exists images_mod_sort_idx on public.images (mod_id, sort_order, created_at) where mod_id is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_vehicles_updated_at on public.vehicles;
create trigger set_vehicles_updated_at
before update on public.vehicles
for each row
execute function public.set_updated_at();

drop trigger if exists set_mods_updated_at on public.mods;
create trigger set_mods_updated_at
before update on public.mods
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.mods enable row level security;
alter table public.images enable row level security;

alter table public.profiles force row level security;
alter table public.vehicles force row level security;
alter table public.mods force row level security;
alter table public.images force row level security;

drop policy if exists profiles_owner_select on public.profiles;
create policy profiles_owner_select
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists profiles_owner_delete on public.profiles;
create policy profiles_owner_delete
on public.profiles
for delete
to authenticated
using (auth.uid() = id);

drop policy if exists profiles_public_select on public.profiles;
create policy profiles_public_select
on public.profiles
for select
to anon, authenticated
using (username is not null);

drop policy if exists vehicles_owner_select on public.vehicles;
create policy vehicles_owner_select
on public.vehicles
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = vehicles.profile_id
      and p.id = auth.uid()
  )
);

drop policy if exists vehicles_owner_insert on public.vehicles;
create policy vehicles_owner_insert
on public.vehicles
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = vehicles.profile_id
      and p.id = auth.uid()
  )
);

drop policy if exists vehicles_owner_update on public.vehicles;
create policy vehicles_owner_update
on public.vehicles
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = vehicles.profile_id
      and p.id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = vehicles.profile_id
      and p.id = auth.uid()
  )
);

drop policy if exists vehicles_owner_delete on public.vehicles;
create policy vehicles_owner_delete
on public.vehicles
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = vehicles.profile_id
      and p.id = auth.uid()
  )
);

drop policy if exists vehicles_public_select on public.vehicles;
create policy vehicles_public_select
on public.vehicles
for select
to anon, authenticated
using (
  is_public = true
  and exists (
    select 1
    from public.profiles p
    where p.id = vehicles.profile_id
      and p.username is not null
  )
);

drop policy if exists mods_owner_select on public.mods;
create policy mods_owner_select
on public.mods
for select
to authenticated
using (
  exists (
    select 1
    from public.vehicles v
    join public.profiles p on p.id = v.profile_id
    where v.id = mods.vehicle_id
      and p.id = auth.uid()
  )
);

drop policy if exists mods_owner_insert on public.mods;
create policy mods_owner_insert
on public.mods
for insert
to authenticated
with check (
  exists (
    select 1
    from public.vehicles v
    join public.profiles p on p.id = v.profile_id
    where v.id = mods.vehicle_id
      and p.id = auth.uid()
  )
);

drop policy if exists mods_owner_update on public.mods;
create policy mods_owner_update
on public.mods
for update
to authenticated
using (
  exists (
    select 1
    from public.vehicles v
    join public.profiles p on p.id = v.profile_id
    where v.id = mods.vehicle_id
      and p.id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.vehicles v
    join public.profiles p on p.id = v.profile_id
    where v.id = mods.vehicle_id
      and p.id = auth.uid()
  )
);

drop policy if exists mods_owner_delete on public.mods;
create policy mods_owner_delete
on public.mods
for delete
to authenticated
using (
  exists (
    select 1
    from public.vehicles v
    join public.profiles p on p.id = v.profile_id
    where v.id = mods.vehicle_id
      and p.id = auth.uid()
  )
);

drop policy if exists mods_public_select on public.mods;
create policy mods_public_select
on public.mods
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.vehicles v
    join public.profiles p on p.id = v.profile_id
    where v.id = mods.vehicle_id
      and v.is_public = true
      and p.username is not null
  )
);

drop policy if exists images_owner_select on public.images;
create policy images_owner_select
on public.images
for select
to authenticated
using (
  images.profile_id = auth.uid()
  and (
    (
      images.vehicle_id is not null
      and exists (
        select 1
        from public.vehicles v
        where v.id = images.vehicle_id
          and v.profile_id = auth.uid()
      )
    )
    or
    (
      images.mod_id is not null
      and exists (
        select 1
        from public.mods m
        join public.vehicles v on v.id = m.vehicle_id
        where m.id = images.mod_id
          and v.profile_id = auth.uid()
      )
    )
  )
);

drop policy if exists images_owner_insert on public.images;
create policy images_owner_insert
on public.images
for insert
to authenticated
with check (
  images.profile_id = auth.uid()
  and (
    (
      images.vehicle_id is not null
      and exists (
        select 1
        from public.vehicles v
        where v.id = images.vehicle_id
          and v.profile_id = auth.uid()
      )
    )
    or
    (
      images.mod_id is not null
      and exists (
        select 1
        from public.mods m
        join public.vehicles v on v.id = m.vehicle_id
        where m.id = images.mod_id
          and v.profile_id = auth.uid()
      )
    )
  )
);

drop policy if exists images_owner_update on public.images;
create policy images_owner_update
on public.images
for update
to authenticated
using (
  images.profile_id = auth.uid()
  and (
    (
      images.vehicle_id is not null
      and exists (
        select 1
        from public.vehicles v
        where v.id = images.vehicle_id
          and v.profile_id = auth.uid()
      )
    )
    or
    (
      images.mod_id is not null
      and exists (
        select 1
        from public.mods m
        join public.vehicles v on v.id = m.vehicle_id
        where m.id = images.mod_id
          and v.profile_id = auth.uid()
      )
    )
  )
)
with check (
  images.profile_id = auth.uid()
  and (
    (
      images.vehicle_id is not null
      and exists (
        select 1
        from public.vehicles v
        where v.id = images.vehicle_id
          and v.profile_id = auth.uid()
      )
    )
    or
    (
      images.mod_id is not null
      and exists (
        select 1
        from public.mods m
        join public.vehicles v on v.id = m.vehicle_id
        where m.id = images.mod_id
          and v.profile_id = auth.uid()
      )
    )
  )
);

drop policy if exists images_owner_delete on public.images;
create policy images_owner_delete
on public.images
for delete
to authenticated
using (
  images.profile_id = auth.uid()
  and (
    (
      images.vehicle_id is not null
      and exists (
        select 1
        from public.vehicles v
        where v.id = images.vehicle_id
          and v.profile_id = auth.uid()
      )
    )
    or
    (
      images.mod_id is not null
      and exists (
        select 1
        from public.mods m
        join public.vehicles v on v.id = m.vehicle_id
        where m.id = images.mod_id
          and v.profile_id = auth.uid()
      )
    )
  )
);

drop policy if exists images_public_select on public.images;
create policy images_public_select
on public.images
for select
to anon, authenticated
using (
  (
    vehicle_id is not null
    and exists (
      select 1
      from public.vehicles v
      join public.profiles p on p.id = v.profile_id
      where v.id = images.vehicle_id
        and v.is_public = true
        and p.username is not null
    )
  )
  or
  (
    mod_id is not null
    and exists (
      select 1
      from public.mods m
      join public.vehicles v on v.id = m.vehicle_id
      join public.profiles p on p.id = v.profile_id
      where m.id = images.mod_id
        and v.is_public = true
        and p.username is not null
    )
  )
);

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.vehicles, public.mods, public.images to anon;
grant select, insert, update, delete on public.profiles, public.vehicles, public.mods, public.images to authenticated;

commit;
