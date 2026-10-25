-- Hidden topics during Brainstorm and hidden votes until reveal, enforced by RLS.
begin;
select plan(21);

-- u1 facilitator, u2 and u3 participants, u9 outsider (signed in, not a member).
select tests.login(tests.u(1));
select set_config('t.created', public.create_board('Fran')::text, true);
select set_config('t.board', current_setting('t.created')::jsonb ->> 'board_id', true);
select set_config('t.code', current_setting('t.created')::jsonb ->> 'code', true);
select tests.login(tests.u(2));
select public.join_board(current_setting('t.code'), 'Pat');
select tests.login(tests.u(3));
select public.join_board(current_setting('t.code'), 'Quinn');

select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'brainstorm');
select set_config('t.tf', public.add_topic(current_setting('t.board')::uuid, 'Facilitator topic')::text, true);
select tests.login(tests.u(2));
select set_config('t.tp', public.add_topic(current_setting('t.board')::uuid, 'Pat topic')::text, true);
select tests.login(tests.u(3));
select set_config('t.tq', public.add_topic(current_setting('t.board')::uuid, 'Quinn topic')::text, true);

-- Brainstorm: own topics only, for everyone including the facilitator.
select tests.login(tests.u(2));
select results_eq('select text from public.topics', array['Pat topic'], 'participant sees only own topic in Brainstorm');
select is((select topic_count from public.board_state), 3, 'participant sees the count of all topics');
select tests.login(tests.u(1));
select results_eq('select text from public.topics', array['Facilitator topic'], 'facilitator sees only own topic in Brainstorm');
select tests.login(tests.u(9));
select is((select count(*) from public.topics), 0::bigint, 'outsider sees no topics');
select is((select count(*) from public.board_state), 0::bigint, 'outsider sees no board state');
select is((select count(*) from public.participants), 0::bigint, 'outsider sees no participants');

-- "Hide topics" off shows everything during Brainstorm.
select tests.login(tests.u(1));
select public.update_settings(current_setting('t.board')::uuid, '{"hide_topics": false}');
select tests.login(tests.u(2));
select is((select count(*) from public.topics), 3::bigint, 'with hide_topics off, participants see all topics');
select tests.login(tests.u(1));
select public.update_settings(current_setting('t.board')::uuid, '{"hide_topics": true}');

-- Clarify reveals all topics.
select public.start_phase(current_setting('t.board')::uuid, 'clarify');
select tests.login(tests.u(2));
select is((select count(*) from public.topics), 3::bigint, 'all topics visible from Clarify on');

-- Vote: own dots only, no totals.
select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'vote');
select tests.login(tests.u(2));
select public.cast_dots(current_setting('t.tq')::uuid, 2);
select public.cast_dots(current_setting('t.tf')::uuid, 1);
select tests.login(tests.u(3));
select public.cast_dots(current_setting('t.tp')::uuid, 3);
select is((select count(*) from public.votes), 1::bigint, 'voter sees only own dots before reveal');
select is((select count(*) from public.vote_totals(current_setting('t.board')::uuid)), 0::bigint,
  'totals are empty before reveal');
select tests.login(tests.u(1));
select is((select count(*) from public.votes), 0::bigint, 'facilitator sees no one else''s dots before reveal');
select is((select count(*) from public.vote_totals(current_setting('t.board')::uuid)), 0::bigint,
  'facilitator gets no totals before reveal');
select tests.login(tests.u(9));
select throws_ok(format('select * from public.vote_totals(%L)', current_setting('t.board')), 'P0001', 'not_member',
  'outsider cannot request totals');

-- Everyone present finishing reveals automatically.
select tests.login(tests.u(1));
select is(public.finish_voting(current_setting('t.board')::uuid), false, 'not revealed while others are voting');
select tests.login(tests.u(2));
select public.finish_voting(current_setting('t.board')::uuid);
select tests.login(tests.u(3));
select is(public.finish_voting(current_setting('t.board')::uuid), true, 'last person finishing reveals the votes');
select is((select count(*) from public.votes), 3::bigint, 'all dots visible after reveal');
select results_eq(
  format('select dots from public.vote_totals(%L) where topic_id = %L', current_setting('t.board'), current_setting('t.tp')),
  array[3], 'totals available after reveal');
select results_eq('select text from public.topics where merged_into is null order by sort_order',
  array['Pat topic', 'Quinn topic', 'Facilitator topic'], 'topics are ranked by votes at reveal');

-- Extend votes hidden until the round closes.
select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'discuss');
select public.start_discussion(current_setting('t.board')::uuid);
select set_config('t.round', public.open_extend_round(current_setting('t.board')::uuid)::text, true);
select tests.login(tests.u(2));
select public.cast_extend_vote(current_setting('t.round')::uuid, 'keep');
select tests.login(tests.u(3));
select is((select count(*) from public.extend_votes), 0::bigint, 'others'' extend votes hidden while the round is open');
select is((select votes_cast from public.extend_rounds), 1, 'the number of extend votes cast is visible');
select tests.login(tests.u(1));
select public.cast_extend_vote(current_setting('t.round')::uuid, 'move_on');
select tests.login(tests.u(3));
select public.cast_extend_vote(current_setting('t.round')::uuid, 'neutral');
select is((select count(*) from public.extend_votes), 3::bigint, 'extend votes visible once everyone has voted');

select * from finish();
rollback;
