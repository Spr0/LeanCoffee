-- Regression tests for the launch audit fixes: Move on applies itself, the facilitator can override
-- it, skipped topics come back, ended boards are read-only, and signed-out callers get only keepalive.
begin;
select plan(20);

select tests.login(tests.u(1));
select set_config('t.created', public.create_board('Fran')::text, true);
select set_config('t.board', current_setting('t.created')::jsonb ->> 'board_id', true);
select set_config('t.code', current_setting('t.created')::jsonb ->> 'code', true);
select tests.login(tests.u(2));
select public.join_board(current_setting('t.code'), 'Pat');
select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'brainstorm');
select public.add_topic(current_setting('t.board')::uuid, 'Topic A');
select public.add_topic(current_setting('t.board')::uuid, 'Topic B');
select public.add_topic(current_setting('t.board')::uuid, 'Topic C');
select public.start_phase(current_setting('t.board')::uuid, 'discuss');
select set_config('t.a', public.start_discussion(current_setting('t.board')::uuid)::text, true);

-- An early vote where everyone chooses Move on sends the topic to Discussed with no facilitator step.
select set_config('t.r1', public.open_extend_round(current_setting('t.board')::uuid)::text, true);
select public.cast_extend_vote(current_setting('t.r1')::uuid, 'move_on');
select tests.login(tests.u(2));
select public.cast_extend_vote(current_setting('t.r1')::uuid, 'move_on');
select is((select status from public.topics where id = current_setting('t.a')::uuid), 'discussed',
  'a Move on vote sends the topic to Discussed');
select is((select current_topic_id from public.board_state), null, 'the stage clears after the group moves on');
select ok((select time_spent_ms >= 0 and discussed_seq = 1 from public.topics where id = current_setting('t.a')::uuid),
  'time spent and discussion order are recorded');

-- Participants cannot override; the facilitator's "Extend anyway" reopens the topic with an extension.
select throws_ok(format('select public.extend_topic(%L)', current_setting('t.board')), 'P0001', 'not_facilitator',
  'participants cannot override the vote');
select tests.login(tests.u(1));
select public.extend_topic(current_setting('t.board')::uuid);
select is((select current_topic_id::text from public.board_state), current_setting('t.a'),
  'Extend anyway puts the topic back on stage');
select is((select status || ':' || extensions || ':' || coalesce(discussed_seq::text, 'none')
             from public.topics where id = current_setting('t.a')::uuid), 'discussing:1:none',
  'the reopened topic is discussing again with one extension');
select ok((select phase_ends_at > now() + interval '170 seconds' from public.board_state),
  'the extension clock is running');
select is((select result || ':' || move_on_count from public.extend_rounds where id = current_setting('t.r1')::uuid),
  'extend:2', 'the overridden round records the extension and keeps the group''s counts');

-- Once another topic has been discussed, the earlier one cannot be reopened.
select public.next_topic(current_setting('t.board')::uuid, 'discussed');
select set_config('t.b', public.start_discussion(current_setting('t.board')::uuid)::text, true);
select public.next_topic(current_setting('t.board')::uuid, 'discussed');
select throws_ok(format('select public.extend_topic(%L)', current_setting('t.board')), 'P0001', 'no_current_topic',
  'Extend anyway only reopens the topic just moved on by a vote');

-- Skipped topics come back to the bottom of the queue, by the facilitator only.
select set_config('t.c', public.start_discussion(current_setting('t.board')::uuid)::text, true);
select public.next_topic(current_setting('t.board')::uuid, 'skipped');
select tests.login(tests.u(2));
select throws_ok(format('select public.restore_topic(%L)', current_setting('t.c')), 'P0001', 'not_facilitator',
  'participants cannot bring a skipped topic back');
select tests.login(tests.u(1));
select public.restore_topic(current_setting('t.c')::uuid);
select is((select status from public.topics where id = current_setting('t.c')::uuid), 'open',
  'the facilitator brings a skipped topic back');
select is((select sort_order = (select max(sort_order) from public.topics) from public.topics
            where id = current_setting('t.c')::uuid), true, 'a restored topic goes to the bottom of the queue');
select throws_ok(format('select public.restore_topic(%L)', current_setting('t.a')), 'P0001', 'topic_unavailable',
  'only skipped topics can be restored');

-- Ended boards: content and settings are read-only; access controls still work.
select public.start_phase(current_setting('t.board')::uuid, 'wrapup');
select tests.login(tests.u(2));
select set_config('t.act', public.add_action(current_setting('t.board')::uuid, 'Write it down')::text, true);
select tests.login(tests.u(1));
select public.end_session(current_setting('t.board')::uuid);
select tests.login(tests.u(2));
select throws_ok(format('select public.toggle_action(%L, true)', current_setting('t.act')), 'P0001', 'session_ended',
  'actions cannot be ticked after the session ends');
select throws_ok(format('select public.delete_action(%L)', current_setting('t.act')), 'P0001', 'session_ended',
  'actions cannot be deleted after the session ends');
select tests.login(tests.u(1));
select throws_ok(format('select public.update_settings(%L, %L, %L)', current_setting('t.board'), '{}', 'Renamed'),
  'P0001', 'session_ended', 'the board cannot be renamed after the session ends');
select throws_ok(format('select public.set_passcode(%L, %L)', current_setting('t.board'), 'new-passcode'),
  'P0001', 'session_ended', 'the passcode cannot change after the session ends');
select throws_ok(format('select public.lock_topics(%L, true)', current_setting('t.board')),
  'P0001', 'session_ended', 'topic locking cannot change after the session ends');
select lives_ok(format('select public.lock_board(%L, true)', current_setting('t.board')),
  'the facilitator can still lock the board after the session ends');

select tests.signed_out();
select throws_ok(format('select public.restore_topic(%L)', current_setting('t.c')), '42501', null,
  'signed-out visitors cannot call restore_topic');

select * from finish();
rollback;
