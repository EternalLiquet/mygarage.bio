begin;

create or replace function public.derive_username_from_email(
  p_email text,
  p_user_id uuid,
  p_with_suffix boolean default false
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_local_part text;
  v_base text;
  v_suffix text;
begin
  v_local_part := split_part(lower(coalesce(p_email, '')), '@', 1);
  v_base := regexp_replace(v_local_part, '[^a-z0-9_]+', '_', 'g');
  v_base := regexp_replace(v_base, '_+', '_', 'g');
  v_base := btrim(v_base, '_');

  if char_length(v_base) < 3 then
    v_base := 'user';
  end if;

  if p_with_suffix then
    v_suffix := right(replace(coalesce(p_user_id::text, ''), '-', ''), 8);
    if char_length(v_suffix) < 8 then
      v_suffix := lpad(v_suffix, 8, '0');
    end if;
    return left(v_base, 21) || '_' || v_suffix;
  end if;

  return left(v_base, 30);
end;
$$;

comment on function public.derive_username_from_email(text, uuid, boolean) is
  'Derives a valid lowercase username candidate from email local-part, with deterministic suffix option.';

revoke all on function public.derive_username_from_email(text, uuid, boolean) from public;
grant execute on function public.derive_username_from_email(text, uuid, boolean) to supabase_auth_admin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_fallback_username text;
begin
  v_username := public.derive_username_from_email(new.email, new.id, false);
  v_fallback_username := public.derive_username_from_email(new.email, new.id, true);

  begin
    insert into public.profiles (id, username, display_name)
    values (new.id, v_username, 'My Garage')
    on conflict (id) do nothing;
  exception
    when unique_violation then
      begin
        insert into public.profiles (id, username, display_name)
        values (new.id, v_fallback_username, 'My Garage')
        on conflict (id) do nothing;
      exception
        when unique_violation then
          insert into public.profiles (id, username, display_name)
          values (new.id, null, 'My Garage')
          on conflict (id) do nothing;
      end;
  end;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to supabase_auth_admin;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

commit;
