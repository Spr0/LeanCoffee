-- Phase 3 QA fixes: clock and extend-vote edge cases found in review.

-- Brainstorm closes when its clock ends even if the facilitator is away: any member may close it
-- once the server deadline has passed (same pattern as reveal_votes).
create function public.close_brainstorm(p_board uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.board_state := private.member_state(p_board);
begin
  if s.phase <> 'brainstorm' then
    return; -- Already closed by someone else.
  end if;
  if s.phase_ends_at is null or s.phase_ends_at > now() then
    raise exception 'not_allowed';
  end if;
  update public.board_state
     set phase = 'clarify', phase_ends_at = null, paused_remaining_ms = null, timer_started_at = null,
         pitch_topic_id = null
   where board_id = p_board;
  perform private.touch(p_board);
end;
$$;

-- Adding time to a clock that already ran out counts from now, not from the old end.
create or replace function public.timer_adjust(p_board uuid, p_delta_s int default null, p_set_s int default null)
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
create or replace function public.open_extend_round(p_board uuid) returns uuid
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

revoke all on function public.close_brainstorm(uuid) from public, anon, authenticated;
grant execute on function public.close_brainstorm(uuid) to authenticated;
revoke all on function public.timer_adjust(uuid, int, int) from public, anon, authenticated;
grant execute on function public.timer_adjust(uuid, int, int) to authenticated;
revoke all on function public.open_extend_round(uuid) from public, anon, authenticated;
grant execute on function public.open_extend_round(uuid) to authenticated;
