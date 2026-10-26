-- Stage presses that lose a race (decision D95; wave 1 RT-1 and RT-2).
-- 1. next_topic, open_extend_round and the timer calls take an optional p_topic: the topic the
--    button was shown for. When it is given and that topic is no longer on stage, the call is
--    refused with topic_unavailable instead of acting on whatever topic is there now. Without it
--    the calls behave as before, so the current client keeps working; a later client sends it.
-- 2. next_topic also refuses, with topic_unavailable, a call that began before the clock on the
--    current topic started: that press was made for an earlier stage. These calls used to fail
--    with a check violation on time_spent_ms (a negative time), which the client showed as
--    "That value is outside the allowed range."
-- 3. close_segment measures to the statement's clock and never adds a negative time, so a call
--    that waited for the board lock cannot fail the time_spent_ms check.

create or replace function private.close_segment(p_board uuid) returns void
language sql
set search_path = ''
as $$
  update public.topics t
     set time_spent_ms = t.time_spent_ms
           + greatest(0, (extract(epoch from clock_timestamp() - s.timer_started_at) * 1000)::bigint)
    from public.board_state s
   where s.board_id = p_board and t.id = s.current_topic_id and s.timer_started_at is not null;
  update public.board_state set timer_started_at = null where board_id = p_board;
$$;

-- Raises topic_unavailable when the caller named a topic and it is not the one on stage.
create function private.assert_on_stage(s public.board_state, p_topic uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_topic is not null and p_topic is distinct from s.current_topic_id then
    raise exception 'topic_unavailable';
  end if;
end;
$$;

drop function public.next_topic(uuid, text);
create function public.next_topic(p_board uuid, p_outcome text default 'discussed',
                                  p_topic uuid default null) returns uuid
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
  perform private.assert_on_stage(s, p_topic);
  -- The clock on this topic started after this call began (it waited for the board lock while
  -- another press finished the topic before and auto-started this one).
  if s.timer_started_at > now() then
    raise exception 'topic_unavailable';
  end if;
  return private.finish_topic(p_board, p_outcome);
end;
$$;

drop function public.timer_pause(uuid);
create function public.timer_pause(p_board uuid, p_topic uuid default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  perform private.assert_on_stage(s, p_topic);
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

drop function public.timer_resume(uuid);
create function public.timer_resume(p_board uuid, p_topic uuid default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.facilitator_state(p_board);
begin
  perform private.assert_on_stage(s, p_topic);
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

-- Adding time to a clock that already ran out counts from now, not from the old end.
drop function public.timer_adjust(uuid, int, int);
create function public.timer_adjust(p_board uuid, p_delta_s int default null, p_set_s int default null,
                                    p_topic uuid default null)
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
  perform private.assert_on_stage(s, p_topic);
  if s.phase_ends_at is not null then
    update public.board_state
       set phase_ends_at = greatest(now(), coalesce(
             now() + make_interval(secs => p_set_s),
             greatest(s.phase_ends_at, now()) + make_interval(secs => p_delta_s)))
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

-- Members may open the automatic extend vote only once per timebox: after a "move on" result
-- the clock stays at zero, and a late joiner's browser must not reopen the vote.
drop function public.open_extend_round(uuid);
create function public.open_extend_round(p_board uuid, p_topic uuid default null) returns uuid
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
  perform private.assert_on_stage(s, p_topic);
  select id into v_id from public.extend_rounds where board_id = p_board and closed_at is null;
  if found then
    return v_id;
  end if;
  if s.facilitator_user_id <> private.uid() then
    if s.phase_ends_at is null or s.phase_ends_at > now() then
      raise exception 'not_allowed';
    end if;
    if exists (select 1 from public.extend_rounds r
                where r.topic_id = s.current_topic_id
                  and r.opened_at >= s.phase_ends_at - interval '1 second') then
      raise exception 'not_allowed';
    end if;
  end if;
  insert into public.extend_rounds (board_id, topic_id, closes_at)
  values (p_board, s.current_topic_id, now() + interval '15 seconds')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.close_segment(uuid) from public, anon, authenticated;
revoke all on function private.assert_on_stage(public.board_state, uuid) from public, anon, authenticated;
revoke all on function public.next_topic(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.next_topic(uuid, text, uuid) to authenticated;
revoke all on function public.timer_pause(uuid, uuid) from public, anon, authenticated;
grant execute on function public.timer_pause(uuid, uuid) to authenticated;
revoke all on function public.timer_resume(uuid, uuid) from public, anon, authenticated;
grant execute on function public.timer_resume(uuid, uuid) to authenticated;
revoke all on function public.timer_adjust(uuid, int, int, uuid) from public, anon, authenticated;
grant execute on function public.timer_adjust(uuid, int, int, uuid) to authenticated;
revoke all on function public.open_extend_round(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_extend_round(uuid, uuid) to authenticated;
