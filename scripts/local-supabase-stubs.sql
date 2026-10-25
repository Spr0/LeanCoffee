-- Minimal stand-ins for the Supabase platform so migrations and pgTAP tests can run on a
-- plain local Postgres when `supabase start` is unavailable. CI uses the real stack.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;
create schema extensions;
create extension pgcrypto with schema extensions;
create extension pgtap with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(current_setting('request.jwt.claim.sub', true),
             (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')),
    '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role;
create table realtime.messages (id bigserial primary key, topic text not null, extension text, payload jsonb);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
grant execute on function realtime.topic() to authenticated;
create publication supabase_realtime;

-- Supabase grants table privileges to API roles by default; mirror that so tests prove revokes.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
