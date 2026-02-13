begin;

-- Replace only the mygarage-scoped policy set.
drop policy if exists mygarage_public_read on storage.objects;
drop policy if exists mygarage_owner_read on storage.objects;
drop policy if exists mygarage_owner_insert on storage.objects;
drop policy if exists mygarage_owner_update on storage.objects;
drop policy if exists mygarage_owner_delete on storage.objects;

-- Keep the bucket private so reads are controlled by policy/signed URL flow.
update storage.buckets
set public = false
where id = 'mygarage';

create or replace function public.mygarage_object_owner_can_write(
  object_name text,
  requester uuid
)
returns boolean
language sql
stable
as $$
  with path as (
    select storage.foldername(object_name) as parts
  )
  select
    requester is not null
    and exists (
      select 1
      from path
      where array_length(parts, 1) = 2
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

create or replace function public.mygarage_object_is_public_readable(
  object_name text
)
returns boolean
language sql
stable
as $$
  select
    object_name is not null
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

commit;
