-- Regression tests for the Phase 3 review fixes.
begin;
select plan(7);

select tests.login(tests.u(1));
select set_config('t.created', public.create_board('Fran')::text, true);
select set_config('t.board', current_setting('t.created')::jsonb ->> 'board_id', true);
select set_config('t.code', current_setting('t.created')::jsonb ->> 'code', true);
select tests.login(tests.u(2));
select public.join_board(current_setting('t.code'), 'Pat');

-- A participant cannot close Brainstorm early, but can once the clock has run out.
select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'brainstorm');
select public.add_topic(current_setting('t.board')::uuid, 'Topic A');
select tests.login(tests.u(2));
select throws_ok(format('select public.close_brainstorm(%L)', current_setting('t.board')), 'P0001', 'not_allowed',
  'participants cannot close Brainstorm before the clock ends');
select tests.as_admin();
update public.board_state set phase_ends_at = now() - interval '1 second';
select tests.login(tests.u(2));
select public.close_brainstorm(current_setting('t.board')::uuid);
select is((select phase from public.board_state), 'clarify', 'any member closes Brainstorm once the clock has ended');

-- Into Discuss with a running topic.
select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'discuss');
select public.start_discussion(current_setting('t.board')::uuid);

-- +1 min on a clock that ended long ago gives a full minute from now.
select tests.as_admin();
update public.board_state set phase_ends_at = now() - interval '5 minutes';
select tests.login(tests.u(1));
select public.timer_adjust(current_setting('t.board')::uuid, 60);
select ok((select phase_ends_at = now() + interval '60 seconds' from public.board_state),
  '+1 min after the clock ran out adds a minute from now');

-- After the clock ends, one automatic vote; once it is closed, members cannot reopen it.
select tests.as_admin();
update public.board_state set phase_ends_at = now() - interval '1 second';
select tests.login(tests.u(2));
select set_config('t.r1', public.open_extend_round(current_setting('t.board')::uuid)::text, true);
select isnt(current_setting('t.r1'), '', 'a member opens the vote once the clock has ended');
select tests.login(tests.u(1));
select public.resolve_extend_round(current_setting('t.r1')::uuid);
select tests.login(tests.u(2));
select throws_ok(format('select public.open_extend_round(%L)', current_setting('t.board')), 'P0001', 'not_allowed',
  'a late joiner cannot reopen the vote after the group decided');
select tests.login(tests.u(1));
select lives_ok(format('select public.open_extend_round(%L)', current_setting('t.board')),
  'the facilitator can still call another vote');
select tests.signed_out();
select throws_ok(format('select public.close_brainstorm(%L)', current_setting('t.board')), '42501', null,
  'signed-out visitors cannot call close_brainstorm');

select * from finish();
rollback;
