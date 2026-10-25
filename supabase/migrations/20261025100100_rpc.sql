-- Lean Coffee RPCs. Every function is SECURITY DEFINER with an empty search_path and fully
-- qualified names. Authorization is by membership rows keyed to auth.uid(), never by role.
-- Errors are raised as short codes the client maps to copy (e.g. 'not_facilitator').

-- ---------------------------------------------------------------------------------------
-- Internal helpers (private schema, not callable by clients)
-- ---------------------------------------------------------------------------------------

-- Volatile on purpose: the planner pre-evaluates stable calls during estimation, which would
-- raise outside a request.
create function private.uid() returns uuid
language plpgsql volatile
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not_authenticated';
  end if;
  return v;
end;
$$;

-- Locks and returns the board state for a member; raises otherwise.
create function private.member_state(p_board uuid) returns public.board_state
language plpgsql
set search_path = ''
as $$
declare
  s public.board_state;
  v_uid uuid := private.uid();
begin
  if not exists (
    select 1 from public.participants p where p.board_id = p_board and p.user_id = v_uid
  ) then
    raise exception 'not_member';
  end if;
  select * into s from public.board_state where board_id = p_board for update;
  return s;
end;
$$;

create function private.facilitator_state(p_board uuid) returns public.board_state
language plpgsql
set search_path = ''
as $$
declare
  s public.board_state := private.member_state(p_board);
begin
  if s.facilitator_user_id <> private.uid() then
    raise exception 'not_facilitator';
  end if;
  return s;
end;
$$;

create function private.touch(p_board uuid) returns void
language sql
set search_path = ''
as $$
  update public.board_state set last_activity_at = now() where board_id = p_board;
$$;

create function private.phase_rank(p_phase text) returns int
language sql immutable
set search_path = ''
as $$
  select array_position(array['lobby', 'brainstorm', 'clarify', 'vote', 'discuss', 'wrapup', 'ended'], p_phase);
$$;

-- Untrusted text: drop control and bidi-override characters, collapse whitespace, trim.
create function private.clean_text(p text) returns text
language sql immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(coalesce(p, ''),
      -- Control chars, zero-width U+200B-200F, bidi embeddings and overrides U+202A-202E and
      -- U+2066-2069, BOM U+FEFF. Built with chr() so the source has no invisible characters.
      '[[:cntrl:]' || chr(8203) || '-' || chr(8207) || chr(8234) || '-' || chr(8238)
        || chr(8294) || '-' || chr(8297) || chr(65279) || ']', '', 'g'),
    '\s+', ' ', 'g'));
$$;

create function private.gen_code() returns text
language sql volatile
set search_path = ''
as $$
  -- 8 symbols from a 32-character alphabet: 256 is a multiple of 32, so byte & 31 is uniform.
  select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (get_byte(b.bytes, i) & 31) + 1, 1), '' order by i)
    from (select extensions.gen_random_bytes(8) as bytes) b, generate_series(0, 7) i;
$$;

create function private.normalize_code(p text) returns text
language sql immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'));
$$;

create function private.record_failure(p_board uuid default null) returns void
language sql
set search_path = ''
as $$
  insert into public.failed_attempts (user_id, board_id) values (auth.uid(), p_board);
$$;

-- Exponential per-user lockout after 5 failures in 15 minutes, plus a global ceiling.
create function private.is_throttled() returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  n int;
  v_last timestamptz;
begin
  select count(*), max(at) into n, v_last
    from public.failed_attempts
   where user_id = auth.uid() and at > now() - interval '15 minutes';
  if n >= 5 and now() < v_last + least(60, power(2, n - 5)) * interval '1 minute' then
    return true;
  end if;
  -- Global ceiling, applied only to callers who are failing themselves, so a flood of bad
  -- lookups cannot lock out legitimate joiners.
  return n > 0
     and (select count(*) from public.failed_attempts where at > now() - interval '1 minute') >= 300;
end;
$$;

create function private.present_count(p_board uuid) returns int
language sql stable
set search_path = ''
as $$
  select count(*)::int from public.participants
   where board_id = p_board and last_seen_at > now() - interval '45 seconds';
$$;

-- Everyone seen in the last 45 s has pressed "I'm done".
create function private.all_finished(p_board uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select private.present_count(p_board) > 0
     and not exists (
       select 1 from public.participants
        where board_id = p_board and last_seen_at > now() - interval '45 seconds' and not finished_voting
     );
$$;

create function private.do_reveal(p_board uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.board_state
     set votes_revealed_at = now(), phase_ends_at = null, paused_remaining_ms = null
   where board_id = p_board and votes_revealed_at is null;

  -- Rank: main-round dots, then tie-round dots, then existing order.
  with totals as (
    select t.id,
           coalesce(sum(v.dots) filter (where v.round = s.base_round), 0) as main,
           coalesce(sum(v.dots) filter (where v.round > s.base_round), 0) as tie,
           t.sort_order
      from public.topics t
      join public.board_state s on s.board_id = t.board_id
      left join public.votes v on v.topic_id = t.id
     where t.board_id = p_board and t.merged_into is null and t.status = 'open'
     group by t.id
  ), ranked as (
    select id, row_number() over (order by main desc, tie desc, sort_order) as rn from totals
  )
  update public.topics t set sort_order = r.rn from ranked r where t.id = r.id;
end;
$$;

-- Adds running discussion time to the current topic and stops the segment clock.
create function private.close_segment(p_board uuid) returns void
language sql
set search_path = ''
as $$
  update public.topics t
     set time_spent_ms = t.time_spent_ms + (extract(epoch from now() - s.timer_started_at) * 1000)::bigint
    from public.board_state s
   where s.board_id = p_board and t.id = s.current_topic_id and s.timer_started_at is not null;
  update public.board_state set timer_started_at = null where board_id = p_board;
$$;

create function private.begin_discussion(p_board uuid, p_topic uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_secs int;
begin
  update public.topics set status = 'discussing'
   where id = p_topic and board_id = p_board and status = 'open' and merged_into is null;
  if not found then
    raise exception 'topic_unavailable';
  end if;
  select (settings ->> 'discuss_s')::int into v_secs from public.board_state where board_id = p_board;
  update public.board_state
     set current_topic_id = p_topic, phase_ends_at = now() + make_interval(secs => v_secs),
         paused_remaining_ms = null, timer_started_at = now()
   where board_id = p_board;
end;
$$;

create function private.do_extend(p_board uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  s public.board_state;
begin
  select * into s from public.board_state where board_id = p_board;
  if s.current_topic_id is null then
    raise exception 'no_current_topic';
  end if;
  perform private.close_segment(p_board);
  update public.topics set extensions = extensions + 1 where id = s.current_topic_id;
  update public.board_state
     set phase_ends_at = now() + make_interval(secs => (s.settings ->> 'extend_s')::int),
         paused_remaining_ms = null, timer_started_at = now()
   where board_id = p_board;
end;
$$;

create function private.close_round(p_round uuid, p_result text) returns void
language plpgsql
set search_path = ''
as $$
declare
  k int; n int; m int;
begin
  select count(*) filter (where choice = 'keep'), count(*) filter (where choice = 'neutral'),
         count(*) filter (where choice = 'move_on')
    into k, n, m
    from public.extend_votes where round_id = p_round;
  update public.extend_rounds
     set closed_at = now(), keep_count = k, neutral_count = n, move_on_count = m,
         result = coalesce(p_result, case when k > m then 'extend' else 'move_on' end)
   where id = p_round and closed_at is null;
end;
$$;

create function private.clean_name(p text) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := private.clean_text(p);
begin
  if char_length(v) < 1 or char_length(v) > 24 then
    raise exception 'invalid_name';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Board lifecycle and access
-- ---------------------------------------------------------------------------------------

create function public.create_board(p_display_name text, p_name text default '', p_passcode text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.uid();
  v_name text := private.clean_name(p_display_name);
  v_token bytea := extensions.gen_random_bytes(32);
  v_id uuid;
  v_code text;
begin
  if (select count(*) from public.board_state
       where owner_user_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'rate_limited';
  end if;
  if p_passcode is not null and char_length(p_passcode) not between 6 and 64 then
    raise exception 'invalid_passcode';
  end if;

  loop
    v_code := private.gen_code();
    begin
      insert into public.boards (code, recovery_hash, passcode_hash)
      values (v_code, extensions.digest(v_token, 'sha256'),
              case when p_passcode is null then null
                   else extensions.crypt(p_passcode, extensions.gen_salt('bf')) end)
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- Code collision (about 1 in 10^12 per pair); draw again.
    end;
  end loop;

  insert into public.board_state (board_id, name, owner_user_id, facilitator_user_id, requires_passcode)
  values (v_id, private.clean_text(p_name), v_uid, v_uid, p_passcode is not null);
  insert into public.participants (board_id, user_id, display_name) values (v_id, v_uid, v_name);

  return jsonb_build_object(
    'board_id', v_id,
    'code', v_code,
    'recovery_token', translate(encode(v_token, 'base64'), E'+/=\n', '-_')
  );
end;
$$;

-- Returns the minimum a joiner needs, or NULL for both "no such board" and "throttled".
create function public.lookup_board(p_code text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.uid();
  r record;
begin
  if private.is_throttled() then
    return null;
  end if;
  select s.name, s.requires_passcode, s.phase,
         (select count(*) from public.participants p where p.board_id = b.id) as n,
         exists (select 1 from public.participants p where p.board_id = b.id and p.user_id = v_uid)
           as already_member
    into r
    from public.boards b join public.board_state s on s.board_id = b.id
   where b.code = private.normalize_code(p_code);
  if not found then
    perform private.record_failure();
    return null;
  end if;
  return jsonb_build_object('name', r.name, 'requires_passcode', r.requires_passcode,
                            'participant_count', r.n, 'ended', r.phase = 'ended',
                            'already_member', r.already_member);
end;
$$;

-- Failures return {ok:false, error} instead of raising so the throttle record is kept.
create function public.join_board(p_code text, p_display_name text, p_passcode text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.uid();
  b public.boards;
  s public.board_state;
  v_base text;
  v_name text;
  i int := 1;
  existing public.participants;
begin
  if private.is_throttled() then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into b from public.boards where code = private.normalize_code(p_code);
  if not found then
    perform private.record_failure();
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into s from public.board_state where board_id = b.id for update;

  select * into existing from public.participants where board_id = b.id and user_id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'board_id', b.id, 'display_name', existing.display_name);
  end if;

  if v_uid = any (b.removed_user_ids) then
    return jsonb_build_object('ok', false, 'error', 'removed');
  end if;
  if b.passcode_hash is not null then
    -- Per-board cap stops guessing spread across many fresh anonymous identities.
    if (select count(*) from public.failed_attempts
         where board_id = b.id and at > now() - interval '1 hour') >= 20
       or p_passcode is null
       or extensions.crypt(p_passcode, b.passcode_hash) <> b.passcode_hash then
      perform private.record_failure(b.id);
      return jsonb_build_object('ok', false, 'error', 'passcode_incorrect');
    end if;
  end if;
  if s.phase = 'ended' then
    return jsonb_build_object('ok', false, 'error', 'session_ended');
  end if;
  if s.locked then
    return jsonb_build_object('ok', false, 'error', 'board_locked');
  end if;
  if (select count(*) from public.participants where board_id = b.id) >= 12 then
    return jsonb_build_object('ok', false, 'error', 'board_full');
  end if;

  begin
    v_base := private.clean_name(p_display_name);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end;
  v_name := v_base;
  while exists (select 1 from public.participants
                 where board_id = b.id and lower(display_name) = lower(v_name)) loop
    i := i + 1;
    v_name := btrim(left(v_base, 24 - char_length(' (' || i || ')'))) || ' (' || i || ')';
  end loop;

  insert into public.participants (board_id, user_id, display_name) values (b.id, v_uid, v_name);
  perform private.touch(b.id);
  return jsonb_build_object('ok', true, 'board_id', b.id, 'display_name', v_name);
end;
$$;

create function public.heartbeat(p_board uuid) returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state;
  v_uid uuid;
begin
  v_uid := private.uid();
  update public.participants set last_seen_at = now()
   where board_id = p_board and user_id = v_uid;
  if not found then
    raise exception 'not_member';
  end if;
  -- Someone leaving can complete "everyone finished".
  select * into s from public.board_state where board_id = p_board;
  if s.phase = 'vote' and s.votes_revealed_at is null and private.all_finished(p_board) then
    perform private.do_reveal(p_board);
  end if;
  return clock_timestamp();
end;
$$;

create function public.server_time() returns timestamptz
language sql security definer
set search_path = ''
as $$
  select clock_timestamp();
$$;

create function public.keepalive() returns text
language sql security definer
set search_path = ''
as $$
  select case when exists (select 1 from public.board_state limit 1) then 'ok' else 'ok' end;
$$;

create function public.update_settings(p_board uuid, p_settings jsonb default '{}', p_name text default null,
                                       p_planned_minutes int default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
  k text;
  v jsonb;
  lo int;
  hi int;
begin
  for k, v in select * from jsonb_each(coalesce(p_settings, '{}')) loop
    if k in ('dots', 'own_vote', 'hide_topics') and s.phase not in ('lobby', 'brainstorm', 'clarify') then
      raise exception 'setting_locked';
    end if;
    case k
      when 'brainstorm_s' then lo := 120; hi := 600;
      when 'pitch_s' then lo := 0; hi := 60;
      when 'vote_s' then lo := 30; hi := 180;
      when 'discuss_s' then lo := 180; hi := 600;
      when 'extend_s' then lo := 60; hi := 300;
      when 'wrapup_s' then lo := 0; hi := 600;
      when 'dots' then lo := 1; hi := 5;
      when 'own_vote', 'hide_topics', 'auto_start_next' then
        if jsonb_typeof(v) <> 'boolean' then raise exception 'invalid_setting'; end if;
        continue;
      when 'tie_break' then
        if v not in ('"drag"', '"mini_vote"', '"random"') then raise exception 'invalid_setting'; end if;
        continue;
      else
        raise exception 'invalid_setting';
    end case;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
       or (v #>> '{}')::int not between lo and hi then
      raise exception 'invalid_setting';
    end if;
  end loop;

  update public.board_state
     set settings = settings || coalesce(p_settings, '{}'),
         name = case when p_name is null then name else private.clean_text(p_name) end,
         planned_minutes = coalesce(p_planned_minutes, planned_minutes)
   where board_id = p_board;
  perform private.touch(p_board);
end;
$$;

create function public.set_passcode(p_board uuid, p_passcode text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.facilitator_state(p_board);
  if nullif(p_passcode, '') is not null and char_length(p_passcode) not between 6 and 64 then
    raise exception 'invalid_passcode';
  end if;
  update public.boards
     set passcode_hash = case when nullif(p_passcode, '') is null then null
                              else extensions.crypt(p_passcode, extensions.gen_salt('bf')) end
   where id = p_board;
  update public.board_state set requires_passcode = nullif(p_passcode, '') is not null where board_id = p_board;
end;
$$;

create function public.lock_board(p_board uuid, p_locked boolean) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.facilitator_state(p_board);
  update public.board_state set locked = p_locked where board_id = p_board;
end;
$$;

create function public.lock_topics(p_board uuid, p_locked boolean) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.facilitator_state(p_board);
  update public.board_state set topics_locked = p_locked where board_id = p_board;
end;
$$;

create function public.remove_participant(p_board uuid, p_user uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.facilitator_state(p_board);
  if p_user = private.uid() then
    raise exception 'cannot_remove_self';
  end if;
  if p_user = (select owner_user_id from public.board_state where board_id = p_board) then
    raise exception 'cannot_remove_owner';
  end if;
  delete from public.participants where board_id = p_board and user_id = p_user;
  if not found then
    raise exception 'not_member';
  end if;
  update public.boards set removed_user_ids = array_append(removed_user_ids, p_user) where id = p_board;
  perform private.touch(p_board);
end;
$$;

create function public.pass_facilitator(p_board uuid, p_to uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.facilitator_state(p_board);
  if not exists (select 1 from public.participants where board_id = p_board and user_id = p_to) then
    raise exception 'not_member';
  end if;
  update public.board_state set facilitator_user_id = p_to where board_id = p_board;
  perform private.touch(p_board);
end;
$$;

-- Restores control to the caller with the recovery token, or to the board owner without it.
create function public.reclaim_facilitator(p_board uuid, p_token text default null) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.member_state(p_board);
  v_hash bytea;
  v_raw bytea;
  v_b64 text;
begin
  if p_token is null then
    if s.owner_user_id <> private.uid() then
      raise exception 'not_owner';
    end if;
  else
    if private.is_throttled() then
      return false;
    end if;
    select recovery_hash into v_hash from public.boards where id = p_board;
    v_b64 := translate(p_token, '-_', '+/');
    v_b64 := v_b64 || repeat('=', (4 - char_length(v_b64) % 4) % 4);
    begin
      v_raw := decode(v_b64, 'base64');
    exception when others then
      v_raw := null;
    end;
    if v_raw is null or extensions.digest(v_raw, 'sha256') <> v_hash then
      perform private.record_failure(p_board);
      -- Return instead of raising so the failure record commits.
      return false;
    end if;
  end if;
  update public.board_state set facilitator_user_id = private.uid() where board_id = p_board;
  perform private.touch(p_board);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Phases and timers
-- ---------------------------------------------------------------------------------------

create function public.start_phase(p_board uuid, p_phase text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
  v_secs int;
begin
  if private.phase_rank(p_phase) is null or private.phase_rank(p_phase) <= private.phase_rank(s.phase) then
    raise exception 'invalid_phase_order';
  end if;

  -- Leaving Discuss mid-topic: book the time and mark it discussed.
  if s.current_topic_id is not null then
    perform private.close_segment(p_board);
    update public.topics
       set status = 'discussed',
           discussed_seq = (select coalesce(max(discussed_seq), 0) + 1 from public.topics where board_id = p_board)
     where id = s.current_topic_id and status = 'discussing';
    update public.extend_rounds set closed_at = now(), result = 'move_on'
     where board_id = p_board and closed_at is null;
  end if;
  if s.phase = 'vote' and s.votes_revealed_at is null then
    perform private.do_reveal(p_board);
  end if;

  v_secs := case p_phase
    when 'brainstorm' then (s.settings ->> 'brainstorm_s')::int
    when 'vote' then (s.settings ->> 'vote_s')::int
    when 'wrapup' then nullif((s.settings ->> 'wrapup_s')::int, 0)
  end;

  update public.board_state
     set phase = p_phase,
         phase_ends_at = case when v_secs is null then null else now() + make_interval(secs => v_secs) end,
         paused_remaining_ms = null, timer_started_at = null, current_topic_id = null, pitch_topic_id = null,
         started_at = case when p_phase = 'brainstorm' then coalesce(started_at, now()) else started_at end,
         ended_at = case when p_phase = 'ended' then now() else ended_at end,
         vote_round = case when p_phase = 'vote' then 0 else vote_round end,
         base_round = case when p_phase = 'vote' then 0 else base_round end,
         tie_topic_ids = '{}',
         votes_revealed_at = case when p_phase = 'vote' then null else votes_revealed_at end
   where board_id = p_board;

  if p_phase = 'vote' then
    update public.participants set finished_voting = false where board_id = p_board;
  end if;
  perform private.touch(p_board);
end;
$$;

create function public.end_session(p_board uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.start_phase(p_board, 'ended');
end;
$$;

create function public.set_pitch(p_board uuid, p_topic uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
  v_secs int := (s.settings ->> 'pitch_s')::int;
begin
  if s.phase <> 'clarify' then
    raise exception 'wrong_phase';
  end if;
  if p_topic is not null and not exists (select 1 from public.topics where id = p_topic and board_id = p_board) then
    raise exception 'topic_unavailable';
  end if;
  update public.board_state
     set pitch_topic_id = p_topic, paused_remaining_ms = null,
         phase_ends_at = case when p_topic is null or v_secs = 0 then null
                              else now() + make_interval(secs => v_secs) end
   where board_id = p_board;
end;
$$;

create function public.timer_pause(p_board uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  if s.phase_ends_at is null then
    raise exception 'timer_not_running';
  end if;
  perform private.close_segment(p_board);
  update public.board_state
     set paused_remaining_ms = greatest(0, (extract(epoch from s.phase_ends_at - now()) * 1000)::int),
         phase_ends_at = null
   where board_id = p_board;
end;
$$;

create function public.timer_resume(p_board uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  if s.paused_remaining_ms is null then
    raise exception 'timer_not_paused';
  end if;
  update public.board_state
     set phase_ends_at = now() + make_interval(secs => s.paused_remaining_ms / 1000.0),
         paused_remaining_ms = null,
         timer_started_at = case when s.current_topic_id is not null then now() end
   where board_id = p_board;
end;
$$;

-- Adds p_delta_s seconds (may be negative) or sets the remaining time to p_set_s.
create function public.timer_adjust(p_board uuid, p_delta_s int default null, p_set_s int default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  if (p_delta_s is null) = (p_set_s is null) or p_set_s < 0 or abs(coalesce(p_delta_s, 0)) > 3600
     or p_set_s > 3600 then
    raise exception 'invalid_adjustment';
  end if;
  if s.phase_ends_at is not null then
    update public.board_state
       set phase_ends_at = greatest(now(), coalesce(now() + make_interval(secs => p_set_s),
                                                     s.phase_ends_at + make_interval(secs => p_delta_s)))
     where board_id = p_board;
  elsif s.paused_remaining_ms is not null then
    update public.board_state
       set paused_remaining_ms = greatest(0, coalesce(p_set_s * 1000, s.paused_remaining_ms + p_delta_s * 1000))
     where board_id = p_board;
  else
    raise exception 'timer_not_running';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Topics
-- ---------------------------------------------------------------------------------------

create function public.add_topic(p_board uuid, p_text text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.member_state(p_board);
  v_uid uuid := private.uid();
  v_id uuid;
begin
  if s.phase not in ('brainstorm', 'discuss') then
    raise exception 'wrong_phase';
  end if;
  if s.topics_locked then
    raise exception 'topics_locked';
  end if;
  if (select count(*) from public.topics where board_id = p_board and author_user_id = v_uid) >= 5 then
    raise exception 'topic_limit';
  end if;
  insert into public.topics (board_id, author_user_id, author_name, text, sort_order)
  values (p_board, v_uid,
          (select display_name from public.participants where board_id = p_board and user_id = v_uid),
          private.clean_text(p_text),
          (select coalesce(max(sort_order), 0) + 1 from public.topics where board_id = p_board))
  returning id into v_id;
  update public.board_state set topic_count = topic_count + 1 where board_id = p_board;
  perform private.touch(p_board);
  return v_id;
end;
$$;

-- Authors may change their own topics during Brainstorm; the facilitator any topic afterwards.
create function private.topic_for_edit(p_topic uuid) returns public.topics
language plpgsql
set search_path = ''
as $$
declare
  t public.topics;
  s public.board_state;
begin
  select * into t from public.topics where id = p_topic;
  if not found then
    raise exception 'topic_unavailable';
  end if;
  s := private.member_state(t.board_id);
  if not ((s.phase = 'brainstorm' and t.author_user_id = private.uid())
          or (s.phase not in ('lobby', 'brainstorm', 'ended') and s.facilitator_user_id = private.uid())) then
    raise exception 'not_allowed';
  end if;
  return t;
end;
$$;

create function public.edit_topic(p_topic uuid, p_text text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.topics := private.topic_for_edit(p_topic);
begin
  update public.topics set text = private.clean_text(p_text) where id = p_topic;
  perform private.touch(t.board_id);
end;
$$;

create function public.delete_topic(p_topic uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.topics := private.topic_for_edit(p_topic);
begin
  if t.status = 'discussing' then
    raise exception 'topic_in_progress';
  end if;
  delete from public.topics where id = p_topic;
  if found then
    update public.board_state set topic_count = greatest(0, topic_count - 1) where board_id = t.board_id;
  end if;
  perform private.touch(t.board_id);
end;
$$;

create function public.merge_topics(p_source uuid, p_target uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  src public.topics;
  tgt public.topics;
  s public.board_state;
begin
  select * into src from public.topics where id = p_source;
  select * into tgt from public.topics where id = p_target;
  if src.id is null or tgt.id is null or src.board_id <> tgt.board_id or src.id = tgt.id
     or tgt.merged_into is not null then
    raise exception 'topic_unavailable';
  end if;
  s := private.facilitator_state(src.board_id);
  if s.phase <> 'clarify' then
    raise exception 'wrong_phase';
  end if;
  -- Re-check under the board lock.
  if (select merged_into from public.topics where id = p_target) is not null then
    raise exception 'topic_unavailable';
  end if;
  update public.topics set merged_into = p_target where merged_into = p_source;
  update public.topics set merged_into = p_target where id = p_source;
  perform private.touch(src.board_id);
end;
$$;

create function public.unmerge_topic(p_topic uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.topics;
  s public.board_state;
begin
  select * into t from public.topics where id = p_topic;
  if not found then
    raise exception 'topic_unavailable';
  end if;
  s := private.facilitator_state(t.board_id);
  if s.phase <> 'clarify' then
    raise exception 'wrong_phase';
  end if;
  update public.topics set merged_into = null where id = p_topic;
  perform private.touch(t.board_id);
end;
$$;

create function public.reorder_topics(p_board uuid, p_ids uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  if s.phase not in ('clarify', 'vote', 'discuss') then
    raise exception 'wrong_phase';
  end if;
  update public.topics t set sort_order = x.ord
    from unnest(p_ids) with ordinality as x(id, ord)
   where t.id = x.id and t.board_id = p_board;
  perform private.touch(p_board);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Voting
-- ---------------------------------------------------------------------------------------

-- Sets the caller's dots on a topic for the current round (0 removes them).
create function public.cast_dots(p_topic uuid, p_dots int) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.topics;
  s public.board_state;
  v_uid uuid := private.uid();
begin
  select * into t from public.topics where id = p_topic;
  if not found then
    raise exception 'topic_unavailable';
  end if;
  s := private.member_state(t.board_id);
  if s.phase <> 'vote' or s.votes_revealed_at is not null then
    raise exception 'voting_closed';
  end if;
  if t.merged_into is not null or t.status <> 'open'
     or (s.vote_round > s.base_round and not (p_topic = any (s.tie_topic_ids))) then
    raise exception 'topic_unavailable';
  end if;
  if t.author_user_id = v_uid and not (s.settings ->> 'own_vote')::boolean and p_dots > 0 then
    raise exception 'own_topic';
  end if;
  if p_dots is null or p_dots < 0 then
    raise exception 'invalid_dots';
  end if;
  insert into public.votes (board_id, topic_id, user_id, round, dots)
  values (t.board_id, p_topic, v_uid, s.vote_round, p_dots)
  on conflict (topic_id, user_id, round) do update set dots = excluded.dots;
  perform private.touch(t.board_id);
end;
$$;

create function public.finish_voting(p_board uuid, p_done boolean default true) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.member_state(p_board);
  v_uid uuid := private.uid();
begin
  if s.phase <> 'vote' or s.votes_revealed_at is not null then
    raise exception 'voting_closed';
  end if;
  update public.participants set finished_voting = p_done, last_seen_at = now()
   where board_id = p_board and user_id = v_uid;
  if private.all_finished(p_board) then
    perform private.do_reveal(p_board);
    return true;
  end if;
  return false;
end;
$$;

-- Facilitator any time; any member once the timer has run out or everyone is finished.
create function public.reveal_votes(p_board uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.member_state(p_board);
begin
  if s.phase <> 'vote' or s.votes_revealed_at is not null then
    raise exception 'voting_closed';
  end if;
  if not (s.facilitator_user_id = private.uid()
          or (s.phase_ends_at is not null and s.phase_ends_at <= now())
          or private.all_finished(p_board)) then
    raise exception 'not_allowed';
  end if;
  perform private.do_reveal(p_board);
end;
$$;

-- Totals per topic and round; empty for any round that is not yet revealed.
create function public.vote_totals(p_board uuid)
returns table (topic_id uuid, round int, dots int)
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.member_state(p_board);
  return query
    select v.topic_id, v.round, sum(v.dots)::int
      from public.votes v join public.board_state s on s.board_id = v.board_id
     where v.board_id = p_board and (v.round < s.vote_round or s.votes_revealed_at is not null)
     group by v.topic_id, v.round;
end;
$$;

create function public.start_tie_vote(p_board uuid, p_topics uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  if s.phase <> 'vote' or s.votes_revealed_at is null then
    raise exception 'wrong_phase';
  end if;
  if cardinality(p_topics) < 2 or (select count(*) from public.topics
       where id = any (p_topics) and board_id = p_board and merged_into is null and status = 'open')
       <> cardinality(p_topics) then
    raise exception 'topic_unavailable';
  end if;
  update public.board_state
     set vote_round = vote_round + 1, tie_topic_ids = p_topics, votes_revealed_at = null,
         phase_ends_at = now() + interval '30 seconds', paused_remaining_ms = null
   where board_id = p_board;
  update public.participants set finished_voting = false where board_id = p_board;
end;
$$;

create function public.break_ties_random(p_board uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  if s.phase <> 'vote' or s.votes_revealed_at is null then
    raise exception 'wrong_phase';
  end if;
  with totals as (
    select t.id, coalesce(sum(v.dots) filter (where v.round = s.base_round), 0) as main,
           coalesce(sum(v.dots) filter (where v.round > s.base_round), 0) as tie
      from public.topics t left join public.votes v on v.topic_id = t.id
     where t.board_id = p_board and t.merged_into is null and t.status = 'open'
     group by t.id
  ), ranked as (
    select id, row_number() over (order by main desc, tie desc, random()) as rn from totals
  )
  update public.topics t set sort_order = r.rn from ranked r where t.id = r.id;
end;
$$;

-- Reopens Vote for one minute in a fresh round with a full dot budget (spec F21).
create function public.revote(p_board uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  if s.phase <> 'discuss' or s.current_topic_id is not null then
    raise exception 'wrong_phase';
  end if;
  -- A fresh round with a full dot budget; earlier rounds stay as visible history.
  update public.board_state
     set phase = 'vote', vote_round = vote_round + 1, base_round = vote_round + 1,
         tie_topic_ids = '{}', votes_revealed_at = null,
         phase_ends_at = now() + interval '60 seconds', paused_remaining_ms = null
   where board_id = p_board;
  update public.participants set finished_voting = false where board_id = p_board;
  perform private.touch(p_board);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Discussion and extend votes
-- ---------------------------------------------------------------------------------------

create function public.start_discussion(p_board uuid, p_topic uuid default null) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
  v_topic uuid := p_topic;
begin
  if s.phase <> 'discuss' then
    raise exception 'wrong_phase';
  end if;
  if s.current_topic_id is not null then
    raise exception 'topic_in_progress';
  end if;
  if v_topic is null then
    select id into v_topic from public.topics
     where board_id = p_board and status = 'open' and merged_into is null
     order by sort_order limit 1;
  end if;
  perform private.begin_discussion(p_board, v_topic);
  perform private.touch(p_board);
  return v_topic;
end;
$$;

-- Facilitator any time; any member once the discussion timer has run out.
create function public.open_extend_round(p_board uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.member_state(p_board);
  v_id uuid;
begin
  if s.phase <> 'discuss' or s.current_topic_id is null then
    raise exception 'wrong_phase';
  end if;
  select id into v_id from public.extend_rounds where board_id = p_board and closed_at is null;
  if found then
    return v_id;
  end if;
  if not (s.facilitator_user_id = private.uid() or (s.phase_ends_at is not null and s.phase_ends_at <= now())) then
    raise exception 'not_allowed';
  end if;
  insert into public.extend_rounds (board_id, topic_id, closes_at)
  values (p_board, s.current_topic_id, now() + interval '15 seconds')
  returning id into v_id;
  return v_id;
end;
$$;

create function private.maybe_resolve(p_round uuid, p_force boolean) returns void
language plpgsql
set search_path = ''
as $$
declare
  r public.extend_rounds;
begin
  select * into r from public.extend_rounds where id = p_round;
  if r.closed_at is not null then
    return;
  end if;
  if p_force or now() >= r.closes_at or r.votes_cast >= private.present_count(r.board_id) then
    perform private.close_round(p_round, null);
    if (select result from public.extend_rounds where id = p_round) = 'extend' then
      perform private.do_extend(r.board_id);
    end if;
  end if;
end;
$$;

create function public.cast_extend_vote(p_round uuid, p_choice text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.extend_rounds;
begin
  select * into r from public.extend_rounds where id = p_round;
  if not found then
    raise exception 'round_unavailable';
  end if;
  perform private.member_state(r.board_id);
  select * into r from public.extend_rounds where id = p_round;  -- re-read under the board lock
  if r.closed_at is not null or now() >= r.closes_at then
    raise exception 'round_closed';
  end if;
  insert into public.extend_votes (round_id, board_id, user_id, choice)
  values (p_round, r.board_id, private.uid(), p_choice)
  on conflict (round_id, user_id) do update set choice = excluded.choice;
  update public.extend_rounds
     set votes_cast = (select count(*) from public.extend_votes where round_id = p_round)
   where id = p_round;
  perform private.maybe_resolve(p_round, false);
end;
$$;

-- Facilitator any time; any member once the window has closed or everyone present has voted.
create function public.resolve_extend_round(p_round uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.extend_rounds;
  s public.board_state;
begin
  select * into r from public.extend_rounds where id = p_round;
  if not found then
    raise exception 'round_unavailable';
  end if;
  s := private.member_state(r.board_id);
  perform private.maybe_resolve(p_round, s.facilitator_user_id = private.uid());
  return (select result from public.extend_rounds where id = p_round);
end;
$$;

-- Facilitator override: extend now regardless of the vote.
create function public.extend_topic(p_board uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
  v_round uuid;
begin
  if s.phase <> 'discuss' then
    raise exception 'wrong_phase';
  end if;
  select id into v_round from public.extend_rounds where board_id = p_board and closed_at is null;
  if found then
    perform private.close_round(v_round, 'extend');
  end if;
  perform private.do_extend(p_board);
  perform private.touch(p_board);
end;
$$;

-- Ends the current topic as discussed, skipped, or deferred (back to the bottom of the queue).
create function public.next_topic(p_board uuid, p_outcome text default 'discussed') returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
  v_next uuid;
begin
  if s.phase <> 'discuss' or s.current_topic_id is null then
    raise exception 'wrong_phase';
  end if;
  if p_outcome not in ('discussed', 'skipped', 'deferred') then
    raise exception 'invalid_outcome';
  end if;
  perform private.close_segment(p_board);
  update public.extend_rounds set closed_at = now(), result = coalesce(result, 'move_on')
   where board_id = p_board and closed_at is null;
  update public.topics t
     set status = case p_outcome when 'deferred' then 'open' else p_outcome end,
         discussed_seq = case when p_outcome = 'discussed'
           then (select coalesce(max(discussed_seq), 0) + 1 from public.topics where board_id = p_board) end,
         sort_order = case when p_outcome = 'deferred'
           then (select max(sort_order) + 1 from public.topics where board_id = p_board) else t.sort_order end
   where t.id = s.current_topic_id;
  update public.board_state
     set current_topic_id = null, phase_ends_at = null, paused_remaining_ms = null
   where board_id = p_board;

  if (s.settings ->> 'auto_start_next')::boolean then
    select id into v_next from public.topics
     where board_id = p_board and status = 'open' and merged_into is null and id <> s.current_topic_id
     order by sort_order limit 1;
    if v_next is not null then
      perform private.begin_discussion(p_board, v_next);
    end if;
  end if;
  perform private.touch(p_board);
  return v_next;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Actions and take-aways
-- ---------------------------------------------------------------------------------------

create function public.add_action(p_board uuid, p_text text, p_owner_name text default null,
                                  p_topic uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.member_state(p_board);
  v_id uuid;
begin
  if s.phase not in ('discuss', 'wrapup') then
    raise exception 'wrong_phase';
  end if;
  if (select count(*) from public.actions where board_id = p_board) >= 60 then
    raise exception 'action_limit';
  end if;
  if p_topic is not null and not exists (select 1 from public.topics where id = p_topic and board_id = p_board) then
    raise exception 'topic_unavailable';
  end if;
  insert into public.actions (board_id, topic_id, text, owner_name, created_by)
  values (p_board, coalesce(p_topic, s.current_topic_id), private.clean_text(p_text),
          nullif(private.clean_text(p_owner_name), ''), private.uid())
  returning id into v_id;
  perform private.touch(p_board);
  return v_id;
end;
$$;

create function public.toggle_action(p_action uuid, p_done boolean) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_board uuid;
begin
  select board_id into v_board from public.actions where id = p_action;
  if not found then
    raise exception 'action_unavailable';
  end if;
  perform private.member_state(v_board);
  update public.actions set done = p_done where id = p_action;
  perform private.touch(v_board);
end;
$$;

create function public.delete_action(p_action uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.actions;
  s public.board_state;
begin
  select * into a from public.actions where id = p_action;
  if not found then
    raise exception 'action_unavailable';
  end if;
  s := private.member_state(a.board_id);
  if a.created_by <> private.uid() and s.facilitator_user_id <> private.uid() then
    raise exception 'not_allowed';
  end if;
  delete from public.actions where id = p_action;
  perform private.touch(a.board_id);
end;
$$;

create function public.set_takeaway(p_board uuid, p_text text, p_passed boolean default false) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.member_state(p_board);
  v_uid uuid := private.uid();
begin
  if s.phase <> 'wrapup' then
    raise exception 'wrong_phase';
  end if;
  insert into public.takeaways (board_id, user_id, author_name, text, passed)
  values (p_board, v_uid,
          (select display_name from public.participants where board_id = p_board and user_id = v_uid),
          case when p_passed then null else private.clean_text(p_text) end, p_passed)
  on conflict (board_id, user_id) do update set text = excluded.text, passed = excluded.passed;
  perform private.touch(p_board);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Privileges: clients may call public RPCs only when signed in (anonymous sign-in counts).
-- ---------------------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
grant execute on function public.keepalive(), public.server_time() to anon;
grant execute on function private.is_member(uuid), private.can_see_topic(uuid, uuid),
  private.votes_visible(uuid, int), private.extend_round_closed(uuid) to authenticated;

-- New functions are not executable by PUBLIC by default; each must be granted explicitly.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema private revoke execute on functions from anon, authenticated;
