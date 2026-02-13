begin;

-- Threat model:
-- 1) `anon` should only read published public profile/vehicle/mod/image data.
-- 2) Public views remain `security_invoker`, so caller grants + RLS still apply.
-- 3) Storage writes must be owner-scoped by path prefix; anonymous writes are denied.

-- Re-assert security_invoker on public views so they never bypass caller RLS context.
alter view public.public_profiles set (security_invoker = true);
alter view public.public_vehicles set (security_invoker = true);
alter view public.public_mods set (security_invoker = true);
alter view public.public_images set (security_invoker = true);

comment on view public.public_profiles is
  'Public profile projection. security_invoker keeps caller RLS + grants in effect.';
comment on view public.public_vehicles is
  'Public vehicle projection. security_invoker keeps caller RLS + grants in effect.';
comment on view public.public_mods is
  'Public mods projection. security_invoker keeps caller RLS + grants in effect.';
comment on view public.public_images is
  'Public images projection. security_invoker keeps caller RLS + grants in effect.';

-- Remove potentially broad legacy privileges from anon and re-grant exact read columns
-- needed by security_invoker public views and PostgREST relationship joins.
revoke all privileges on public.profiles from anon;
revoke all privileges on public.vehicles from anon;
revoke all privileges on public.mods from anon;
revoke all privileges on public.images from anon;
revoke all privileges on public.public_profiles from anon;
revoke all privileges on public.public_vehicles from anon;
revoke all privileges on public.public_mods from anon;
revoke all privileges on public.public_images from anon;

grant usage on schema public to anon;

grant select (id, username, display_name, bio, avatar_image_path, created_at)
on public.profiles
to anon;

grant select (id, profile_id, name, year, make, model, trim, hero_image_path, sort_order, created_at, is_public)
on public.vehicles
to anon;

grant select (id, vehicle_id, title, category, cost_cents, notes, installed_on, sort_order, created_at)
on public.mods
to anon;

grant select (id, vehicle_id, mod_id, storage_bucket, storage_path, caption, sort_order, created_at)
on public.images
to anon;

grant select on public.public_profiles, public.public_vehicles, public.public_mods, public.public_images
to anon;

-- Try to keep the bucket private; skip instead of failing when migration role
-- cannot manage storage metadata directly.
do $$
begin
  begin
    update storage.buckets
    set public = false
    where id = 'mygarage';
  exception
    when insufficient_privilege then
      raise notice
        'Skipping storage.buckets update to private: insufficient privileges for role %.',
        current_user;
  end;
end;
$$;

create or replace function public.mygarage_object_owner_can_write(
  object_name text,
  requester uuid
)
returns boolean
language sql
stable
set search_path = public
as $$
  with path as (
    select
      storage.foldername(object_name) as parts,
      nullif(storage.filename(object_name), '') as filename
  )
  select
    requester is not null
    and object_name is not null
    and object_name !~ '(^|/)\.\.(/|$)'
    and object_name !~ '//'
    and exists (
      select 1
      from path
      where array_length(parts, 1) = 2
        and filename is not null
        and (
          (
            parts[1] = 'avatars'
            and parts[2] = requester::text
          )
          or
          (
            parts[1] = 'vehicles'
            and exists (
              select 1
              from public.vehicles v
              where v.id::text = parts[2]
                and v.profile_id = requester
            )
          )
          or
          (
            parts[1] = 'mods'
            and exists (
              select 1
              from public.mods m
              join public.vehicles v on v.id = m.vehicle_id
              where m.id::text = parts[2]
                and v.profile_id = requester
            )
          )
        )
    );
$$;

comment on function public.mygarage_object_owner_can_write(text, uuid) is
  'Owner-write guard for mygarage paths. Allows only avatars/{uid}/..., vehicles/{vehicleId}/..., mods/{modId}/... for the authenticated owner.';

create or replace function public.mygarage_object_is_public_readable(
  object_name text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    object_name is not null
    and object_name !~ '(^|/)\.\.(/|$)'
    and object_name !~ '//'
    and (
      exists (
        select 1
        from public.public_profiles pp
        where pp.avatar_image_path = object_name
      )
      or exists (
        select 1
        from public.public_vehicles pv
        where pv.hero_image_path = object_name
      )
      or exists (
        select 1
        from public.public_images pi
        where pi.storage_bucket = 'mygarage'
          and pi.storage_path = object_name
      )
    );
$$;

comment on function public.mygarage_object_is_public_readable(text) is
  'Public-read guard for mygarage objects; only files referenced by public profile/vehicle/image views are readable by anon.';

-- Lock function execution to the exact roles used by policy evaluation.
revoke all on function public.mygarage_object_owner_can_write(text, uuid) from public;
revoke all on function public.mygarage_object_is_public_readable(text) from public;
grant execute on function public.mygarage_object_owner_can_write(text, uuid) to authenticated;
grant execute on function public.mygarage_object_is_public_readable(text) to anon, authenticated;

-- Rebuild mygarage storage policies only when this migration role can manage
-- `storage.objects`. If not, existing policies remain and still consume the
-- hardened helper functions above.
do $$
declare
  v_objects_owner text;
  v_can_manage_storage_policies boolean := false;
begin
  select pg_get_userbyid(c.relowner)
  into v_objects_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage'
    and c.relname = 'objects'
    and c.relkind = 'r';

  v_can_manage_storage_policies := v_objects_owner is not null
    and (
      v_objects_owner = current_user
      or pg_has_role(current_user, v_objects_owner, 'MEMBER')
    );

  if not v_can_manage_storage_policies then
    raise notice
      'Skipping storage.objects policy DDL for role %; table owner is %.',
      current_user,
      coalesce(v_objects_owner, 'unknown');
    return;
  end if;

  begin
    drop policy if exists mygarage_public_read on storage.objects;
    drop policy if exists mygarage_owner_read on storage.objects;
    drop policy if exists mygarage_owner_insert on storage.objects;
    drop policy if exists mygarage_owner_update on storage.objects;
    drop policy if exists mygarage_owner_delete on storage.objects;

    create policy mygarage_public_read
    on storage.objects
    for select
    to anon, authenticated
    using (
      bucket_id = 'mygarage'
      and public.mygarage_object_is_public_readable(name)
    );

    create policy mygarage_owner_read
    on storage.objects
    for select
    to authenticated
    using (
      bucket_id = 'mygarage'
      and public.mygarage_object_owner_can_write(name, auth.uid())
    );

    create policy mygarage_owner_insert
    on storage.objects
    for insert
    to authenticated
    with check (
      bucket_id = 'mygarage'
      and public.mygarage_object_owner_can_write(name, auth.uid())
    );

    create policy mygarage_owner_update
    on storage.objects
    for update
    to authenticated
    using (
      bucket_id = 'mygarage'
      and public.mygarage_object_owner_can_write(name, auth.uid())
    )
    with check (
      bucket_id = 'mygarage'
      and public.mygarage_object_owner_can_write(name, auth.uid())
    );

    create policy mygarage_owner_delete
    on storage.objects
    for delete
    to authenticated
    using (
      bucket_id = 'mygarage'
      and public.mygarage_object_owner_can_write(name, auth.uid())
    );

    comment on policy mygarage_public_read on storage.objects is
      'Anon/authenticated read only for mygarage objects currently referenced by published public content.';
    comment on policy mygarage_owner_read on storage.objects is
      'Authenticated owner read access for owner-scoped mygarage paths.';
    comment on policy mygarage_owner_insert on storage.objects is
      'Authenticated owner write access for owner-scoped mygarage paths. Anonymous writes are blocked.';
    comment on policy mygarage_owner_update on storage.objects is
      'Authenticated owner update access for owner-scoped mygarage paths. Anonymous writes are blocked.';
    comment on policy mygarage_owner_delete on storage.objects is
      'Authenticated owner delete access for owner-scoped mygarage paths. Anonymous writes are blocked.';
  exception
    when insufficient_privilege then
      raise notice
        'Skipping storage.objects policy DDL for role % due to insufficient privileges.',
        current_user;
  end;
end;
$$;

commit;
