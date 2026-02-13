begin;

-- Fix: avoid ambiguity between RETURNS TABLE output column `window_ends_at`
-- and the table column of the same name inside the SQL `returning` clause.
create or replace function public.rate_limit_consume(
  p_bucket_key text,
  p_max_requests integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer,
  window_ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := trim(coalesce(p_bucket_key, ''));
  v_now timestamptz := timezone('utc', now());
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds, 1), 86400));
  v_max_requests integer := greatest(1, least(coalesce(p_max_requests, 1), 100000));
  v_window_started_at timestamptz;
  v_window_ends_at timestamptz;
  v_expires_at timestamptz;
  v_request_count integer;
begin
  if v_key = '' then
    raise exception 'rate_limit_consume requires a non-empty key';
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  );
  v_window_ends_at := v_window_started_at + make_interval(secs => v_window_seconds);
  v_expires_at := v_window_ends_at + make_interval(secs => greatest(v_window_seconds, 600));

  insert into public.rate_limit_buckets as rl (
    bucket_key,
    window_started_at,
    window_seconds,
    request_count,
    window_ends_at,
    expires_at,
    updated_at
  )
  values (
    v_key,
    v_window_started_at,
    v_window_seconds,
    1,
    v_window_ends_at,
    v_expires_at,
    v_now
  )
  on conflict (bucket_key)
  do update
  set
    request_count = case
      when rl.window_started_at = excluded.window_started_at
        and rl.window_seconds = excluded.window_seconds
      then rl.request_count + 1
      else 1
    end,
    window_started_at = excluded.window_started_at,
    window_seconds = excluded.window_seconds,
    window_ends_at = excluded.window_ends_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at
  returning rl.request_count, rl.window_ends_at
  into v_request_count, v_window_ends_at;

  if random() < 0.02 then
    perform public.rate_limit_cleanup_expired(200);
  end if;

  allowed := v_request_count <= v_max_requests;
  remaining := greatest(v_max_requests - v_request_count, 0);
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from (v_window_ends_at - v_now)))::integer
    )
  end;
  window_ends_at := v_window_ends_at;

  return next;
end;
$$;

-- Ensure the intended privilege model remains in place after replace.
revoke all on function public.rate_limit_consume(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_consume(text, integer, integer) to service_role;

commit;
