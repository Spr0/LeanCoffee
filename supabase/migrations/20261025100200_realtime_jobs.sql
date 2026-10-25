-- Realtime authorization, retention purge, and the daily schedule.

-- Postgres Changes (RLS applied per subscriber) carry all table state.
alter publication supabase_realtime add table
  public.board_state, public.participants, public.topics, public.votes,
  public.extend_rounds, public.extend_votes, public.actions, public.takeaways;

-- Private Broadcast/Presence channels: only members may use topic 'board:<uuid>'.
create function private.is_member_topic(p_topic text) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_topic is null or p_topic !~ '^board:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_member(substr(p_topic, 7)::uuid);
end;
$$;
revoke all on function private.is_member_topic(text) from public, anon, authenticated;
grant execute on function private.is_member_topic(text) to authenticated;

create policy board_members_receive on realtime.messages
  for select to authenticated using ((select private.is_member_topic(realtime.topic())));
create policy board_members_send on realtime.messages
  for insert to authenticated with check ((select private.is_member_topic(realtime.topic())));

-- Deletes boards 7 days after they end (or after last activity), their children by cascade,
-- stale throttle rows, and anonymous users older than 14 days with no live membership.
-- Logs counts only, never content. Not callable through the API.
create function private.purge_expired() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  n_boards int;
  n_users int;
begin
  delete from public.boards b using public.board_state s
   where s.board_id = b.id and coalesce(s.ended_at, s.last_activity_at) < now() - interval '7 days';
  get diagnostics n_boards = row_count;

  delete from public.failed_attempts where at < now() - interval '1 day';

  delete from auth.users u
   where u.is_anonymous and u.created_at < now() - interval '14 days'
     and not exists (select 1 from public.participants p where p.user_id = u.id);
  get diagnostics n_users = row_count;

  return jsonb_build_object('boards', n_boards, 'anonymous_users', n_users);
end;
$$;
revoke all on function private.purge_expired() from public, anon, authenticated;

-- Daily at 03:17 UTC. pg_cron is available on Supabase; skipped where it is not installed.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('lean-coffee-purge', '17 3 * * *', 'select private.purge_expired()');
  else
    raise notice 'pg_cron not available; schedule private.purge_expired() externally';
  end if;
end;
$$;
