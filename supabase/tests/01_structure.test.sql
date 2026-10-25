-- Structural guarantees: RLS everywhere, pinned search_path, minimal privileges.
begin;
select plan(9);

select is(
  (select array_agg(c.relname order by c.relname) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null,
  'RLS is enabled on every table in public'
);

select is(
  (select array_agg(p.oid::regprocedure::text) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce(p.proconfig @> array['search_path=""'], false)),
  null,
  'every SECURITY DEFINER function sets search_path to empty'
);

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  array['keepalive'],
  'signed-out visitors can call only keepalive'
);

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')),
  array['can_see_topic', 'extend_round_closed', 'is_member', 'is_member_topic', 'votes_visible'],
  'clients can execute only the read-only policy helpers in private'
);

select is(
  (select count(*) from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'),
  0::bigint,
  'anon has no table privileges in public'
);

select is(
  (select count(*) from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public' and privilege_type <> 'SELECT'),
  0::bigint,
  'authenticated has no write privileges on any table'
);

select ok(
  not has_table_privilege('authenticated', 'public.boards', 'select')
  and not has_table_privilege('authenticated', 'public.failed_attempts', 'select'),
  'boards and failed_attempts are not readable by clients'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and cmd <> 'SELECT'),
  0::bigint,
  'no write policies exist on public tables'
);

select is(
  (select array_agg(cmd || ':' || policyname) from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'),
  array['SELECT:board_members_receive'],
  'realtime.messages: members may receive, nobody may send'
);

select * from finish();
rollback;
