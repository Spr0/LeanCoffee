-- Launch audit fixes (decisions D60 to D62).
-- 1. A "Move on" extend vote is applied by the server: the topic goes to Discussed (spec section 3,
--    Discuss step 7), so the session keeps moving without the facilitator. The facilitator can
--    still override with "Extend anyway", which reopens that topic with an extension.
-- 2. Skipped topics can be brought back (spec F20, "Undo within the session").
-- 3. An ended board is read-only for content and settings (spec F25). Access controls (lock,
--    remove, hand over, reclaim) still work so a leaked link can be shut down after the session.
-- 4. Signed-out callers can run only keepalive() (prompt 4.6 and 6.4).

-- Ends the current topic as discussed, skipped, or deferred. Callers hold the board lock.
create function private.finish_topic(p_board uuid, p_outcome text) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  s public.board_state;
  v_next uuid;
begin
  select * into s from public.board_state where board_id = p_board;
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

create or replace function public.next_topic(p_board uuid, p_outcome text default 'discussed') returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  if s.phase <> 'discuss' or s.current_topic_id is null then
    raise exception 'wrong_phase';
  end if;
  if p_outcome not in ('discussed', 'skipped', 'deferred') then
    raise exception 'invalid_outcome';
  end if;
  return private.finish_topic(p_board, p_outcome);
end;
$$;

create or replace function private.maybe_resolve(p_round uuid, p_force boolean) returns void
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
    elsif (select current_topic_id from public.board_state where board_id = r.board_id) = r.topic_id then
      perform private.finish_topic(r.board_id, 'discussed');
    end if;
  end if;
end;
$$;

-- Facilitator override: extend now regardless of the vote. With no topic on stage, it reopens the
-- topic the group just voted to move on from, provided nothing has been discussed since. The
-- overridden round keeps the group's counts but its result becomes 'extend', so it is used once.
create or replace function public.extend_topic(p_board uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
  v_round uuid;
  v_topic uuid;
  v_moved uuid;
begin
  if s.phase <> 'discuss' then
    raise exception 'wrong_phase';
  end if;
  if s.current_topic_id is null then
    select r.id, r.topic_id into v_moved, v_topic
      from public.extend_rounds r join public.topics t on t.id = r.topic_id
     where r.board_id = p_board and t.status = 'discussed'
       and t.discussed_seq = (select max(discussed_seq) from public.topics where board_id = p_board)
     order by r.opened_at desc limit 1;
    if v_topic is null or (select result from public.extend_rounds where id = v_moved) <> 'move_on'
       or (select keep_count from public.extend_rounds where id = v_moved) is null then
      raise exception 'no_current_topic';
    end if;
    update public.extend_rounds set result = 'extend' where id = v_moved;
    update public.topics set status = 'discussing', discussed_seq = null where id = v_topic;
    update public.board_state set current_topic_id = v_topic where board_id = p_board;
  end if;
  select id into v_round from public.extend_rounds where board_id = p_board and closed_at is null;
  if found then
    perform private.close_round(v_round, 'extend');
  end if;
  perform private.do_extend(p_board);
  perform private.touch(p_board);
end;
$$;

-- Facilitator: bring a skipped topic back to the bottom of the queue.
create function public.restore_topic(p_topic uuid) returns void
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
  if s.phase <> 'discuss' then
    raise exception 'wrong_phase';
  end if;
  if t.status <> 'skipped' then
    raise exception 'topic_unavailable';
  end if;
  update public.topics
     set status = 'open', sort_order = (select max(sort_order) + 1 from public.topics where board_id = t.board_id)
   where id = p_topic;
  perform private.touch(t.board_id);
end;
$$;

-- Ended boards: content and settings are read-only.
create function private.assert_open(s public.board_state) returns void
language plpgsql
set search_path = ''
as $$
begin
  if s.phase = 'ended' then
    raise exception 'session_ended';
  end if;
end;
$$;

create or replace function public.update_settings(p_board uuid, p_settings jsonb default '{}', p_name text default null,
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
  perform private.assert_open(s);
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

create or replace function public.set_passcode(p_board uuid, p_passcode text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.assert_open(private.facilitator_state(p_board));
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

create or replace function public.lock_topics(p_board uuid, p_locked boolean) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.assert_open(private.facilitator_state(p_board));
  update public.board_state set topics_locked = p_locked where board_id = p_board;
end;
$$;

create or replace function public.toggle_action(p_action uuid, p_done boolean) returns void
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
  perform private.assert_open(private.member_state(v_board));
  update public.actions set done = p_done where id = p_action;
  perform private.touch(v_board);
end;
$$;

create or replace function public.delete_action(p_action uuid) returns void
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
  perform private.assert_open(s);
  if a.created_by <> private.uid() and s.facilitator_user_id <> private.uid() then
    raise exception 'not_allowed';
  end if;
  delete from public.actions where id = p_action;
  perform private.touch(a.board_id);
end;
$$;

revoke all on function private.finish_topic(uuid, text) from public, anon, authenticated;
revoke all on function private.assert_open(public.board_state) from public, anon, authenticated;
revoke all on function public.restore_topic(uuid) from public, anon, authenticated;
grant execute on function public.restore_topic(uuid) to authenticated;
revoke execute on function public.server_time() from anon;
