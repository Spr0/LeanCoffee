-- Retention: purge deletes exactly the expired boards, their children, and stale anonymous users.
begin;
select plan(7);

select tests.login(tests.u(1));
select set_config('t.a', public.create_board('Fran', 'Ended long ago')::jsonb ->> 'board_id', true);
select set_config('t.b', public.create_board('Fran', 'Recent')::jsonb ->> 'board_id', true);
select set_config('t.c', public.create_board('Fran', 'Abandoned')::jsonb ->> 'board_id', true);
select public.start_phase(current_setting('t.a')::uuid, 'brainstorm');
select public.add_topic(current_setting('t.a')::uuid, 'Old topic');

select tests.as_admin();
update public.board_state set ended_at = now() - interval '8 days' where board_id = current_setting('t.a')::uuid;
update public.board_state set last_activity_at = now() - interval '6 days' where board_id = current_setting('t.b')::uuid;
update public.board_state set last_activity_at = now() - interval '8 days' where board_id = current_setting('t.c')::uuid;

insert into auth.users (id, is_anonymous, created_at) values
  (tests.u(101), true, now() - interval '15 days'),   -- stale, no membership: delete
  (tests.u(102), true, now() - interval '15 days'),   -- stale but member of a live board: keep
  (tests.u(103), true, now() - interval '1 day'),     -- recent: keep
  (tests.u(104), false, now() - interval '15 days');  -- not anonymous: keep
insert into public.participants (board_id, user_id, display_name)
values (current_setting('t.b')::uuid, tests.u(102), 'Member');

select is(private.purge_expired(), '{"boards": 2, "anonymous_users": 1}'::jsonb, 'purge reports what it deleted');
select results_eq('select name from public.board_state order by name', array['Recent'], 'only the live board remains');
select is((select count(*) from public.boards), 1::bigint, 'board secrets are deleted with the board');
select is((select count(*) from public.topics where board_id = current_setting('t.a')::uuid), 0::bigint,
  'children cascade with their board');
select results_eq(
  'select id from auth.users where id in (tests.u(101), tests.u(102), tests.u(103), tests.u(104)) order by id',
  $$select unnest(array[tests.u(102), tests.u(103), tests.u(104)])$$,
  'only stale anonymous users without a live membership are deleted');

select tests.login(tests.u(1));
select throws_ok('select private.purge_expired()', '42501', null, 'clients cannot run the purge');
select tests.signed_out();
select is(public.keepalive(), 'ok', 'keepalive answers signed-out callers');

select * from finish();
rollback;
