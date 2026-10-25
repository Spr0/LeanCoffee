-- Shared helpers for the pgTAP suite. Runs first (file order) and commits, so later files can
-- use them. Only ever runs against a throwaway test database.
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- Acts as an anonymous-signed-in user (role authenticated, is_anonymous claim) for the rest of
-- the current transaction.
create or replace function tests.login(p_user uuid) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Signed-out visitor: anon role, no JWT subject.
create or replace function tests.signed_out() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.as_admin() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- Deterministic test users: tests.u(1) = 00000000-0000-0000-0000-000000000001, etc.
create or replace function tests.u(n int) returns uuid
language sql immutable as $$
  select lpad(to_hex(n), 32, '0')::uuid;
$$;

grant execute on all functions in schema tests to anon, authenticated;

begin;
select plan(1);
select ok(true, 'test helpers installed');
select * from finish();
rollback;
