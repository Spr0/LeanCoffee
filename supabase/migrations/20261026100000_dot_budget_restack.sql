-- Dots stacked one click at a time were refused (decision D89).
-- cast_dots() sends a topic's new total with insert ... on conflict do update. Postgres runs the
-- BEFORE INSERT budget trigger on the proposed row, with a new id, before it finds the conflict,
-- so the topic's existing row was counted as well as its new total: a third dot on one topic,
-- or a second on a topic after a dot elsewhere, failed with dot_budget_exceeded. A user has one
-- row per topic and round (unique (topic_id, user_id, round)), and the row being written replaces
-- it, so the sum leaves out that topic rather than that id. The update path is unchanged.
create or replace function private.check_dot_budget() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_budget int;
  v_used int;
begin
  select case when new.round = s.base_round then (s.settings ->> 'dots')::int else 1 end
    into v_budget
    from public.board_state s
   where s.board_id = new.board_id;

  select coalesce(sum(v.dots), 0) into v_used
    from public.votes v
   where v.board_id = new.board_id and v.user_id = new.user_id and v.round = new.round
     and v.topic_id <> new.topic_id;

  if v_used + new.dots > v_budget then
    raise exception 'dot_budget_exceeded';
  end if;
  return new;
end;
$$;
