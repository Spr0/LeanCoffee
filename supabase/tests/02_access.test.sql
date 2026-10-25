-- Board creation, lookup, joining, caps, passcodes, throttling, and direct-read denial.
begin;
select plan(26);

-- Facilitator (u1) creates a board.
select tests.login(tests.u(1));
select set_config('t.created', public.create_board('Facilitator', 'Team sync')::text, true);
select set_config('t.board', current_setting('t.created')::jsonb ->> 'board_id', true);
select set_config('t.code', current_setting('t.created')::jsonb ->> 'code', true);

select matches(current_setting('t.code'), '^[2-9A-HJ-NP-Z]{8}$', 'board code is 8 unambiguous characters');
select is(char_length(current_setting('t.created')::jsonb ->> 'recovery_token'), 43,
  'recovery token is 32 bytes as unpadded base64url');
select throws_ok('select * from public.boards', '42501', null, 'creator cannot read boards directly');
select is((select count(*) from public.board_state where board_id = current_setting('t.board')::uuid), 1::bigint,
  'creator reads their board state');

-- Participant (u2) looks up and joins; lookup accepts the grouped display format.
select tests.login(tests.u(2));
select is(public.lookup_board(left(current_setting('t.code'), 4) || '-' || right(current_setting('t.code'), 4)) ->> 'name',
  'Team sync', 'lookup returns the board name for a valid code');
select is(public.lookup_board('ZZZZZZZZ'), null, 'lookup returns null for an unknown code');
select is(public.join_board(current_setting('t.code'), 'Pat') ->> 'ok', 'true', 'participant joins with a valid code');
select is(public.join_board(current_setting('t.code'), 'Someone else') ->> 'display_name', 'Pat',
  'rejoining keeps the original identity');
select throws_ok('select * from public.boards', '42501', null, 'participant cannot read boards directly');

-- Name collisions get a suffix; names are cleaned.
select tests.login(tests.u(3));
select is(public.join_board(current_setting('t.code'), '  pat ') ->> 'display_name', 'pat (2)',
  'case-insensitive name collision gets a suffix');
select tests.login(tests.u(4));
select is(public.join_board(current_setting('t.code'), E'Ann‮ie\t  Lee') ->> 'display_name', 'Annie Lee',
  'control and bidi-override characters are stripped from names');
select tests.login(tests.u(5));
select is(public.join_board(current_setting('t.code'), '   ') ->> 'error', 'invalid_name', 'blank names are rejected');

-- Hard cap of 12 participants.
select tests.as_admin();
do $$
begin
  for i in 6..13 loop
    perform tests.login(tests.u(i));
    perform public.join_board(current_setting('t.code'), 'Filler ' || i);
  end loop;
  perform tests.as_admin();
end;
$$;
select is((select count(*) from public.participants where board_id = current_setting('t.board')::uuid), 12::bigint,
  'board holds 12 participants');
select tests.login(tests.u(14));
select is(public.join_board(current_setting('t.code'), 'Thirteenth') ->> 'error', 'board_full',
  'the 13th participant is rejected');

-- Locked board rejects new joiners.
select tests.login(tests.u(1));
select public.create_board('Facilitator', 'Locked') ->> 'code' as c \gset
select set_config('t.code2', :'c', true);
select set_config('t.board2', (select board_id::text from public.board_state where name = 'Locked'), true);
select public.lock_board(current_setting('t.board2')::uuid, true);
select tests.login(tests.u(2));
select is(public.join_board(current_setting('t.code2'), 'Pat') ->> 'error', 'board_locked', 'locked board rejects joiners');

-- Passcode.
select tests.login(tests.u(1));
select public.create_board('Facilitator', 'Secret', 'open-sesame') ->> 'code' as c \gset
select set_config('t.code3', :'c', true);
select tests.login(tests.u(2));
select is(public.lookup_board(current_setting('t.code3')) ->> 'requires_passcode', 'true', 'lookup reports a passcode is required');
select is(public.join_board(current_setting('t.code3'), 'Pat') ->> 'error', 'passcode_incorrect', 'missing passcode is rejected');
select is(public.join_board(current_setting('t.code3'), 'Pat', 'wrong') ->> 'error', 'passcode_incorrect', 'wrong passcode is rejected');
select is(public.join_board(current_setting('t.code3'), 'Pat', 'open-sesame') ->> 'ok', 'true', 'correct passcode joins');
select tests.as_admin();
select ok((select passcode_hash like '$2%' from public.boards where code = current_setting('t.code3')),
  'passcode is stored as a bcrypt hash');

-- Throttling: after 5 failures, even a valid code looks exactly like an unknown one.
select tests.login(tests.u(50));
select public.lookup_board('2222222' || n) from generate_series(2, 6) n;
select is(public.lookup_board(current_setting('t.code')), null, 'throttled lookup of a valid code returns null like a missing board');
select is(public.join_board(current_setting('t.code'), 'Mallory'), public.join_board('ZZZZZZZZ', 'Mallory'),
  'throttled join is indistinguishable from an unknown code');

-- The global ceiling does not lock out callers who are not failing themselves.
select tests.as_admin();
insert into public.failed_attempts (user_id) select tests.u(60) from generate_series(1, 300);
select tests.login(tests.u(61));
select is(public.lookup_board(current_setting('t.code')) ->> 'name', 'Team sync',
  'a flood of failures by others does not block a legitimate lookup');

-- Passcode guessing spread across identities stops after 20 failures per board per hour.
select tests.as_admin();
insert into public.failed_attempts (user_id, board_id)
select tests.u(70 + n), (select id from public.boards where code = current_setting('t.code3'))
  from generate_series(1, 20) n;
select tests.login(tests.u(3));
select is(public.join_board(current_setting('t.code3'), 'Quinn', 'open-sesame') ->> 'error', 'passcode_incorrect',
  'per-board cap refuses even the right passcode during a guessing attack');

-- Signed-out visitors cannot use the API at all.
select tests.signed_out();
select throws_ok($$select public.create_board('Anon')$$, '42501', null, 'signed-out visitor cannot create a board');
select throws_ok($$select public.lookup_board('ABCDEFGH')$$, '42501', null, 'signed-out visitor cannot look up a board');

select * from finish();
rollback;
