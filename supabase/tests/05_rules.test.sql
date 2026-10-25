-- Session rules: caps, lengths, dot budget, own-topic rule, phase gates, extend rule, timers.
begin;
select plan(26);

select tests.login(tests.u(1));
select set_config('t.created', public.create_board('Fran')::text, true);
select set_config('t.board', current_setting('t.created')::jsonb ->> 'board_id', true);
select set_config('t.code', current_setting('t.created')::jsonb ->> 'code', true);
select tests.login(tests.u(2));
select public.join_board(current_setting('t.code'), 'Pat');
select tests.login(tests.u(3));
select public.join_board(current_setting('t.code'), 'Quinn');

-- Topics only during Brainstorm (or Discuss parking lot).
select tests.login(tests.u(2));
select throws_ok(format('select public.add_topic(%L, %L)', current_setting('t.board'), 'Too early'),
  'P0001', 'wrong_phase', 'topics cannot be added in the Lobby');
select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'brainstorm');

-- Lengths and caps.
select tests.login(tests.u(2));
select throws_ok(format('select public.add_topic(%L, %L)', current_setting('t.board'), repeat('x', 161)),
  '23514', null, 'topic text over 160 characters is rejected');
select throws_ok(format('select public.add_topic(%L, %L)', current_setting('t.board'), '   '),
  '23514', null, 'blank topic text is rejected');
select set_config('t.xss', public.add_topic(current_setting('t.board')::uuid, '<img src=x onerror=alert(1)>')::text, true);
select is((select text from public.topics where id = current_setting('t.xss')::uuid), '<img src=x onerror=alert(1)>',
  'markup is stored as inert text (escaped at render)');
select public.add_topic(current_setting('t.board')::uuid, 'Pat ' || n) from generate_series(2, 5) n;
select throws_ok(format('select public.add_topic(%L, %L)', current_setting('t.board'), 'Sixth'),
  'P0001', 'topic_limit', 'sixth topic per person is rejected');

-- Authors edit their own topics during Brainstorm only; others cannot.
select tests.login(tests.u(3));
select set_config('t.tq', public.add_topic(current_setting('t.board')::uuid, 'Quinn topic')::text, true);
select tests.login(tests.u(2));
select throws_ok(format('select public.edit_topic(%L, %L)', current_setting('t.tq'), 'hijack'),
  'P0001', 'not_allowed', 'participants cannot edit others'' topics');

-- Dots outside the Vote phase.
select throws_ok(format('select public.cast_dots(%L, 1)', current_setting('t.tq')),
  'P0001', 'voting_closed', 'dots cannot be cast outside the Vote phase');

-- Merge and undo in Clarify.
select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'clarify');
select public.merge_topics(current_setting('t.xss')::uuid, current_setting('t.tq')::uuid);
select is((select merged_into from public.topics where id = current_setting('t.xss')::uuid), current_setting('t.tq')::uuid,
  'facilitator merges duplicates');
select public.unmerge_topic(current_setting('t.xss')::uuid);
select is((select merged_into from public.topics where id = current_setting('t.xss')::uuid), null, 'merge can be undone');

-- Dot budget and own-topic rule.
select public.start_phase(current_setting('t.board')::uuid, 'vote');
select tests.login(tests.u(2));
select throws_ok(format('select public.cast_dots(%L, 1)', current_setting('t.xss')),
  'P0001', 'own_topic', 'voting on your own topic is rejected by default');
select lives_ok(format('select public.cast_dots(%L, 3)', current_setting('t.tq')), 'stacking all dots on one topic is allowed');
select tests.login(tests.u(3));
select public.cast_dots(current_setting('t.xss')::uuid, 2);
select throws_ok(format('select public.cast_dots((select id from public.topics where text = %L), 2)', 'Pat 2'),
  'P0001', 'dot_budget_exceeded', 'more than the dot budget is rejected');
select tests.as_admin();
select throws_ok(format($$insert into public.votes (board_id, topic_id, user_id, dots)
                         values (%L, (select id from public.topics where text = 'Pat 3'), %L, 2)$$,
                        current_setting('t.board'), tests.u(3)),
  'P0001', 'dot_budget_exceeded', 'the dot budget also holds as a table constraint');

-- Settings that shape voting are locked once voting starts.
select tests.login(tests.u(1));
select throws_ok(format('select public.update_settings(%L, %L)', current_setting('t.board'), '{"dots": 5}'),
  'P0001', 'setting_locked', 'dots cannot change during Vote');
select throws_ok(format('select public.update_settings(%L, %L)', current_setting('t.board'), '{"vote_s": 5}'),
  'P0001', 'invalid_setting', 'out-of-range timers are rejected');

-- Extend rule: Keep must beat Move on; ties move on; the facilitator can force a result.
select public.start_phase(current_setting('t.board')::uuid, 'discuss');
select public.start_discussion(current_setting('t.board')::uuid);
select set_config('t.r1', public.open_extend_round(current_setting('t.board')::uuid)::text, true);
select public.cast_extend_vote(current_setting('t.r1')::uuid, 'keep');
select tests.login(tests.u(2));
select public.cast_extend_vote(current_setting('t.r1')::uuid, 'move_on');
select tests.login(tests.u(3));
select public.cast_extend_vote(current_setting('t.r1')::uuid, 'neutral');
select is((select result from public.extend_rounds where id = current_setting('t.r1')::uuid), 'move_on',
  'a Keep/Move on tie moves on');
select tests.login(tests.u(1));
select public.extend_topic(current_setting('t.board')::uuid);
select set_config('t.r2', public.open_extend_round(current_setting('t.board')::uuid)::text, true);
select public.cast_extend_vote(current_setting('t.r2')::uuid, 'keep');
select tests.login(tests.u(2));
select public.cast_extend_vote(current_setting('t.r2')::uuid, 'keep');
select tests.login(tests.u(3));
select public.cast_extend_vote(current_setting('t.r2')::uuid, 'move_on');
select is((select result from public.extend_rounds where id = current_setting('t.r2')::uuid), 'extend',
  'Keep outnumbering Move on extends');
select is((select extensions from public.topics where status = 'discussing'), 2,
  'override plus vote recorded two extensions');
select tests.login(tests.u(1));
select set_config('t.r3', public.open_extend_round(current_setting('t.board')::uuid)::text, true);
select is(public.resolve_extend_round(current_setting('t.r3')::uuid), 'move_on',
  'no votes means move on (facilitator closes early)');

-- Timer pause and resume.
select public.timer_pause(current_setting('t.board')::uuid);
select ok((select phase_ends_at is null and paused_remaining_ms between 179000 and 180000 from public.board_state),
  'pause stores the remaining time');
select public.timer_resume(current_setting('t.board')::uuid);
select ok((select phase_ends_at is not null and paused_remaining_ms is null from public.board_state),
  'resume restarts the countdown from the stored remainder');

-- Next topic books the discussion.
select public.next_topic(current_setting('t.board')::uuid);
select is((select count(*) from public.topics where status = 'discussed' and discussed_seq = 1), 1::bigint,
  'next topic marks the current topic discussed in order');

-- Settings updates keep the board name unless a new one is given.
select public.update_settings(current_setting('t.board')::uuid, '{"extend_s": 120}');
select is((select name from public.board_state), '', 'settings update leaves the name alone');
select public.update_settings(current_setting('t.board')::uuid, '{}', 'Retro');
select is((select name from public.board_state), 'Retro', 'name can be changed');

-- Re-vote restores a full dot budget even when dots sat on discussed topics.
select public.revote(current_setting('t.board')::uuid);
-- u3 still has 2 dots from round 0 on an open topic; the new round must not count them.
select tests.login(tests.u(3));
select lives_ok(format('select public.cast_dots((select id from public.topics where text = %L), 3)', 'Pat 2'),
  'after a re-vote, voters have their full dot budget again');
select tests.login(tests.u(2));
select is((select count(*) from public.votes where round = 0), 2::bigint,
  'earlier rounds stay visible while the re-vote is hidden');

select * from finish();
rollback;
