begin;

create or replace function public.reorder_vehicle_swap(
  p_vehicle_id uuid,
  p_direction text
)
returns table (
  outcome text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.vehicles%rowtype;
  v_neighbor public.vehicles%rowtype;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'invalid direction';
  end if;

  if v_user_id is null then
    outcome := 'not_found';
    return next;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(format('reorder_vehicle:%s', v_user_id::text), 0)
  );

  select v.*
  into v_current
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.profile_id = v_user_id
  for update;

  if not found then
    outcome := 'not_found';
    return next;
    return;
  end if;

  if p_direction = 'up' then
    select v.*
    into v_neighbor
    from public.vehicles v
    where v.profile_id = v_user_id
      and (
        v.sort_order < v_current.sort_order
        or (
          v.sort_order = v_current.sort_order
          and (
            v.created_at < v_current.created_at
            or (v.created_at = v_current.created_at and v.id < v_current.id)
          )
        )
      )
    order by v.sort_order desc, v.created_at desc, v.id desc
    limit 1
    for update;
  else
    select v.*
    into v_neighbor
    from public.vehicles v
    where v.profile_id = v_user_id
      and (
        v.sort_order > v_current.sort_order
        or (
          v.sort_order = v_current.sort_order
          and (
            v.created_at > v_current.created_at
            or (v.created_at = v_current.created_at and v.id > v_current.id)
          )
        )
      )
    order by v.sort_order asc, v.created_at asc, v.id asc
    limit 1
    for update;
  end if;

  if not found then
    outcome := 'boundary';
    return next;
    return;
  end if;

  update public.vehicles v
  set sort_order = case
    when v.id = v_current.id then v_neighbor.sort_order
    when v.id = v_neighbor.id then v_current.sort_order
    else v.sort_order
  end
  where v.id in (v_current.id, v_neighbor.id)
    and v.profile_id = v_user_id;

  outcome := 'moved';
  return next;
end;
$$;

create or replace function public.reorder_mod_swap(
  p_vehicle_id uuid,
  p_mod_id uuid,
  p_direction text
)
returns table (
  outcome text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.mods%rowtype;
  v_neighbor public.mods%rowtype;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'invalid direction';
  end if;

  if v_user_id is null then
    outcome := 'not_found';
    return next;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format('reorder_mod:%s:%s', v_user_id::text, coalesce(p_vehicle_id::text, '')),
      0
    )
  );

  select m.*
  into v_current
  from public.mods m
  join public.vehicles v on v.id = m.vehicle_id
  where m.id = p_mod_id
    and m.vehicle_id = p_vehicle_id
    and v.profile_id = v_user_id
  for update of m;

  if not found then
    outcome := 'not_found';
    return next;
    return;
  end if;

  if p_direction = 'up' then
    select m.*
    into v_neighbor
    from public.mods m
    where m.vehicle_id = p_vehicle_id
      and (
        m.sort_order < v_current.sort_order
        or (
          m.sort_order = v_current.sort_order
          and (
            m.created_at < v_current.created_at
            or (m.created_at = v_current.created_at and m.id < v_current.id)
          )
        )
      )
    order by m.sort_order desc, m.created_at desc, m.id desc
    limit 1
    for update;
  else
    select m.*
    into v_neighbor
    from public.mods m
    where m.vehicle_id = p_vehicle_id
      and (
        m.sort_order > v_current.sort_order
        or (
          m.sort_order = v_current.sort_order
          and (
            m.created_at > v_current.created_at
            or (m.created_at = v_current.created_at and m.id > v_current.id)
          )
        )
      )
    order by m.sort_order asc, m.created_at asc, m.id asc
    limit 1
    for update;
  end if;

  if not found then
    outcome := 'boundary';
    return next;
    return;
  end if;

  update public.mods m
  set sort_order = case
    when m.id = v_current.id then v_neighbor.sort_order
    when m.id = v_neighbor.id then v_current.sort_order
    else m.sort_order
  end
  where m.id in (v_current.id, v_neighbor.id)
    and m.vehicle_id = p_vehicle_id;

  outcome := 'moved';
  return next;
end;
$$;

revoke all on function public.reorder_vehicle_swap(uuid, text)
from public, anon;
revoke all on function public.reorder_mod_swap(uuid, uuid, text)
from public, anon;

grant execute on function public.reorder_vehicle_swap(uuid, text)
to authenticated;
grant execute on function public.reorder_mod_swap(uuid, uuid, text)
to authenticated;

commit;
