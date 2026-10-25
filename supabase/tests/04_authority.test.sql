-- Facilitator authority, handover, reclaim, and removal.
begin;
select plan(18);

select tests.login(tests.u(1));
select set_config('t.created', public.create_board('Fran')::text, true);
select set_config('t.board', current_setting('t.created')::jsonb ->> 'board_id', true);
select set_config('t.code', current_setting('t.created')::jsonb ->> 'code', true);
select set_config('t.token', current_setting('t.created')::jsonb ->> 'recovery_token', true);
select tests.login(tests.u(2));
select public.join_board(current_setting('t.code'), 'Pat');
select tests.login(tests.u(3));
select public.join_board(current_setting('t.code'), 'Quinn');

-- Participants cannot use facilitator controls.
select tests.login(tests.u(2));
select throws_ok(format('select public.start_phase(%L, %L)', current_setting('t.board'), 'brainstorm'),
  'P0001', 'not_facilitator', 'participant cannot change phase');
select throws_ok(format('select public.lock_board(%L, true)', current_setting('t.board')),
  'P0001', 'not_facilitator', 'participant cannot lock the board');
select throws_ok(format('select public.remove_participant(%L, %L)', current_setting('t.board'), tests.u(3)),
  'P0001', 'not_facilitator', 'participant cannot remove someone');
select tests.login(tests.u(1));
select public.pass_facilitator(current_setting('t.board')::uuid, tests.u(2));
select tests.login(tests.u(2));
select throws_ok(format('select public.remove_participant(%L, %L)', current_setting('t.board'), tests.u(1)),
  'P0001', 'cannot_remove_owner', 'nobody can remove the board owner');
select tests.login(tests.u(1));
select public.reclaim_facilitator(current_setting('t.board')::uuid);
select tests.login(tests.u(2));
select throws_ok(format('select public.pass_facilitator(%L, %L)', current_setting('t.board'), tests.u(2)),
  'P0001', 'not_facilitator', 'participant cannot take the facilitator role');

-- Phase order.
select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'brainstorm');
select throws_ok(format('select public.start_phase(%L, %L)', current_setting('t.board'), 'lobby'),
  'P0001', 'invalid_phase_order', 'phases cannot go backwards');
select throws_ok(format('select public.start_phase(%L, %L)', current_setting('t.board'), 'party'),
  'P0001', 'invalid_phase_order', 'unknown phases are rejected');

-- Handover takes effect immediately.
select public.pass_facilitator(current_setting('t.board')::uuid, tests.u(2));
select throws_ok(format('select public.timer_resume(%L)', current_setting('t.board')),
  'P0001', 'not_facilitator', 'previous facilitator loses control after handover');
select tests.login(tests.u(2));
select lives_ok(format('select public.timer_resume(%L)', current_setting('t.board')), 'new facilitator has control');

-- Owner reclaims without a token.
select tests.login(tests.u(1));
select is(public.reclaim_facilitator(current_setting('t.board')::uuid), true, 'board owner reclaims without a token');
select is((select facilitator_user_id from public.board_state), tests.u(1), 'owner is facilitator again');

-- Recovery token path.
select public.pass_facilitator(current_setting('t.board')::uuid, tests.u(2));
select tests.login(tests.u(3));
select throws_ok(format('select public.reclaim_facilitator(%L)', current_setting('t.board')),
  'P0001', 'not_owner', 'non-owner cannot reclaim without the token');
select is(public.reclaim_facilitator(current_setting('t.board')::uuid, 'not-the-token'), false, 'wrong token fails');
select is((select facilitator_user_id from public.board_state), tests.u(2), 'facilitator unchanged after a wrong token');
select is(public.reclaim_facilitator(current_setting('t.board')::uuid, current_setting('t.token')), true,
  'the recovery token restores control');

-- Removal cuts reads immediately and blocks rejoining with the same identity.
select tests.login(tests.u(1));
select public.reclaim_facilitator(current_setting('t.board')::uuid);
select public.remove_participant(current_setting('t.board')::uuid, tests.u(3));
select tests.login(tests.u(3));
select is((select count(*) from public.board_state) + (select count(*) from public.participants)
          + (select count(*) from public.topics), 0::bigint, 'removed participant reads nothing');
select throws_ok(format('select public.heartbeat(%L)', current_setting('t.board')),
  'P0001', 'not_member', 'removed participant cannot call member RPCs');
select is(public.join_board(current_setting('t.code'), 'Quinn again') ->> 'error', 'removed',
  'removed participant cannot rejoin with the same identity');

select * from finish();
rollback;
