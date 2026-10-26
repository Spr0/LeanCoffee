-- Dot budget when dots are added one at a time (decision D89): each click sends the topic's new
-- total, which replaces the user's row for that topic, so it must not also count the old one.
begin;
select plan(10);

select tests.login(tests.u(1));
select set_config('t.created', public.create_board('Fran')::text, true);
select set_config('t.board', current_setting('t.created')::jsonb ->> 'board_id', true);
select set_config('t.code', current_setting('t.created')::jsonb ->> 'code', true);
select tests.login(tests.u(2));
select public.join_board(current_setting('t.code'), 'Pat');
select tests.login(tests.u(1));
select public.start_phase(current_setting('t.board')::uuid, 'brainstorm');
select set_config('t.a', public.add_topic(current_setting('t.board')::uuid, 'Topic A')::text, true);
select set_config('t.b', public.add_topic(current_setting('t.board')::uuid, 'Topic B')::text, true);
select public.start_phase(current_setting('t.board')::uuid, 'vote');

-- Pat has the default 3 dots and stacks them on one topic, one click at a time.
select tests.login(tests.u(2));
select lives_ok(format('select public.cast_dots(%L, 1)', current_setting('t.a')), 'a first dot on a topic');
select lives_ok(format('select public.cast_dots(%L, 2)', current_setting('t.a')), 'a second dot stacked on it');
select lives_ok(format('select public.cast_dots(%L, 3)', current_setting('t.a')), 'a third dot stacked on it');
select throws_ok(format('select public.cast_dots(%L, 1)', current_setting('t.b')),
  'P0001', 'dot_budget_exceeded', 'no fourth dot on another topic');

-- Spread, then stacked: one on A, one on B, then a second on A.
select public.cast_dots(current_setting('t.a')::uuid, 1);
select lives_ok(format('select public.cast_dots(%L, 1)', current_setting('t.b')), 'one dot on each of two topics');
select lives_ok(format('select public.cast_dots(%L, 2)', current_setting('t.a')),
  'a second dot on the first topic after one on another');
select throws_ok(format('select public.cast_dots(%L, 2)', current_setting('t.b')),
  'P0001', 'dot_budget_exceeded', 'a second dot on the other topic would make four');
select is((select sum(dots)::int from public.votes where user_id = tests.u(2)), 3,
  'every dot cast within the budget is kept');
select lives_ok(format('select public.cast_dots(%L, 2)', current_setting('t.a')),
  'sending the same total again at the limit, as a retry does');

-- Taking dots off works at the limit too.
select lives_ok(format('select public.cast_dots(%L, 0)', current_setting('t.a')), 'dots come off a topic');

select * from finish();
rollback;
