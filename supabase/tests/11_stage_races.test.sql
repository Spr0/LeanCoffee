-- Stage presses that lose a race (decision D95): a named topic that left the stage is refused,
-- a press that began before the current topic's clock started is refused, and a lock wait never
-- records a negative time. Calls without p_topic behave as before.
begin;
select plan(17);

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
select set_config('t.other', (select id::text from public.topics
                                where board_id = current_setting('t.board')::uuid
                                  and id <> current_setting('t.a')::uuid limit 1), true);

-- Naming a topic that is not on stage is refused and changes nothing.
select throws_ok(format('select public.timer_pause(%L, %L)', current_setting('t.board'), current_setting('t.other')),
  'P0001', 'topic_unavailable', 'Pause for a topic that is not on stage is refused');
select throws_ok(format('select public.timer_adjust(%L, 60, null, %L)', current_setting('t.board'), current_setting('t.other')),
  'P0001', 'topic_unavailable', 'adding time for a topic that is not on stage is refused');
select throws_ok(format('select public.open_extend_round(%L, %L)', current_setting('t.board'), current_setting('t.other')),
  'P0001', 'topic_unavailable', 'an extend vote for a topic that is not on stage is refused');
select throws_ok(format('select public.next_topic(%L, %L, %L)', current_setting('t.board'), 'discussed', current_setting('t.other')),
  'P0001', 'topic_unavailable', 'Next topic for a topic that is not on stage is refused');
select is((select current_topic_id::text || ':' || (phase_ends_at is not null) from public.board_state
            where board_id = current_setting('t.board')::uuid), current_setting('t.a') || ':true',
  'the topic on stage and its clock are unchanged');

-- Naming the topic on stage works, as does naming none.
select lives_ok(format('select public.timer_pause(%L, %L)', current_setting('t.board'), current_setting('t.a')),
  'Pause for the topic on stage');
select lives_ok(format('select public.timer_adjust(%L, 60, null, %L)', current_setting('t.board'), current_setting('t.a')),
  'adding time for the topic on stage');
select lives_ok(format('select public.timer_resume(%L, %L)', current_setting('t.board'), current_setting('t.a')),
  'Resume for the topic on stage');
select lives_ok(format('select public.timer_adjust(%L, 60)', current_setting('t.board')),
  'the clock calls still work without a topic');
select lives_ok(format('select public.open_extend_round(%L, %L)', current_setting('t.board'), current_setting('t.a')),
  'an extend vote for the topic on stage');

-- A press that began before the topic's clock started was made for an earlier stage.
select tests.as_admin();
update public.board_state set timer_started_at = now() + interval '1 second'
 where board_id = current_setting('t.board')::uuid;
select tests.login(tests.u(1));
select throws_ok(format('select public.next_topic(%L)', current_setting('t.board')),
  'P0001', 'topic_unavailable', 'a Next topic that waited while the clock restarted is refused');

-- A lock wait never records a negative time: Pause adds nothing rather than failing.
select set_config('t.spent', (select time_spent_ms::text from public.topics
                                where id = current_setting('t.a')::uuid), true);
select lives_ok(format('select public.timer_pause(%L)', current_setting('t.board')),
  'Pause after a clock that started later than the call');
select is((select time_spent_ms from public.topics where id = current_setting('t.a')::uuid),
  current_setting('t.spent')::bigint, 'no negative time is added');

-- Without a topic, Next topic moves on as before.
select public.timer_resume(current_setting('t.board')::uuid);
select tests.as_admin();
update public.board_state set timer_started_at = now() - interval '5 seconds'
 where board_id = current_setting('t.board')::uuid;
select tests.login(tests.u(1));
select lives_ok(format('select public.next_topic(%L, %L, %L)', current_setting('t.board'), 'discussed', current_setting('t.a')),
  'Next topic for the topic on stage');
select ok((select status = 'discussed' and time_spent_ms >= 5000 from public.topics where id = current_setting('t.a')::uuid),
  'the topic is discussed with its time');

-- Members still cannot use the facilitator's calls, with or without a topic.
select set_config('t.b', public.start_discussion(current_setting('t.board')::uuid)::text, true);
select tests.login(tests.u(2));
select throws_ok(format('select public.next_topic(%L, %L, %L)', current_setting('t.board'), 'discussed', current_setting('t.b')),
  'P0001', 'not_facilitator', 'a participant cannot move the topic on');
select throws_ok(format('select public.timer_pause(%L, %L)', current_setting('t.board'), current_setting('t.b')),
  'P0001', 'not_facilitator', 'a participant cannot pause');

select * from finish();
rollback;
