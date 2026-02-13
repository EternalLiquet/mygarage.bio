begin;

grant select (id, username)
on public.profiles
to anon;

commit;
