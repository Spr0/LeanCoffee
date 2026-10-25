-- Lean Coffee schema: tables, constraints, RLS helpers and read policies.
-- Writes happen only through SECURITY DEFINER RPCs (next migration). Clients get SELECT on
-- member-scoped tables and nothing else. See SECURITY.md and docs/decisions.md.

create schema if not exists private;
-- Policy helpers live here; authenticated needs USAGE to evaluate them. The schema is not
-- exposed through the Data API, so these cannot be called as RPCs.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------

-- Secrets for a board. Never readable by clients (no policies, no grants).
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[2-9A-HJ-NP-Z]{8}$'),
  recovery_hash bytea not null,
  passcode_hash text,
  removed_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Public state of a board, readable by its members and streamed over Realtime.
create table public.board_state (
  board_id uuid primary key references public.boards (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 60),
  owner_user_id uuid not null,
  facilitator_user_id uuid not null,
  settings jsonb not null default '{
    "brainstorm_s": 300, "pitch_s": 30, "vote_s": 90, "discuss_s": 300, "extend_s": 180,
    "wrapup_s": 300, "dots": 3, "own_vote": false, "hide_topics": true,
    "tie_break": "drag", "auto_start_next": false
  }'::jsonb,
  requires_passcode boolean not null default false,
  phase text not null default 'lobby'
    check (phase in ('lobby', 'brainstorm', 'clarify', 'vote', 'discuss', 'wrapup', 'ended')),
  planned_minutes int not null default 75 check (planned_minutes between 15 and 240),
  phase_ends_at timestamptz,
  paused_remaining_ms int check (paused_remaining_ms >= 0),
  timer_started_at timestamptz,
  current_topic_id uuid,
  pitch_topic_id uuid,
  vote_round int not null default 0 check (vote_round >= 0),
  -- Round where the current ranking starts: 0, or the round a re-vote opened. Later rounds
  -- up to vote_round are tie-break rounds among tie_topic_ids.
  base_round int not null default 0 check (base_round between 0 and vote_round),
  tie_topic_ids uuid[] not null default '{}',
  votes_revealed_at timestamptz,
  topic_count int not null default 0 check (topic_count >= 0),
  locked boolean not null default false,
  topics_locked boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  last_activity_at timestamptz not null default now(),
  check (phase_ends_at is null or paused_remaining_ms is null)
);
create index board_state_owner_idx on public.board_state (owner_user_id, created_at);
create index board_state_purge_idx on public.board_state ((coalesce(ended_at, last_activity_at)));

-- Surrogate uuid keys on every streamed table: Realtime DELETE events carry only the primary
-- key and are not filtered by RLS, so natural keys (board, user, topic) must not be the PK.
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  finished_voting boolean not null default false,
  unique (board_id, user_id)
);
create unique index participants_board_name_key on public.participants (board_id, lower(display_name));
create index participants_user_idx on public.participants (user_id);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  author_user_id uuid not null,
  author_name text not null check (char_length(author_name) between 1 and 24),
  text text not null check (char_length(text) between 1 and 160),
  status text not null default 'open' check (status in ('open', 'discussing', 'discussed', 'skipped')),
  merged_into uuid references public.topics (id) on delete set null,
  sort_order int not null default 0,
  time_spent_ms bigint not null default 0 check (time_spent_ms >= 0),
  extensions int not null default 0 check (extensions >= 0),
  discussed_seq int,
  created_at timestamptz not null default now(),
  check (merged_into is null or merged_into <> id)
);
create index topics_board_idx on public.topics (board_id, sort_order);
create index topics_author_idx on public.topics (board_id, author_user_id);
create index topics_merged_idx on public.topics (merged_into);

alter table public.board_state
  add constraint board_state_current_topic_fk foreign key (current_topic_id)
    references public.topics (id) on delete set null,
  add constraint board_state_pitch_topic_fk foreign key (pitch_topic_id)
    references public.topics (id) on delete set null;
create index board_state_current_topic_idx on public.board_state (current_topic_id);
create index board_state_pitch_topic_idx on public.board_state (pitch_topic_id);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  user_id uuid not null,
  round int not null default 0 check (round >= 0),
  dots int not null check (dots between 0 and 5),
  unique (topic_id, user_id, round)
);
create index votes_board_user_idx on public.votes (board_id, user_id, round);

create table public.extend_rounds (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  votes_cast int not null default 0,
  keep_count int,
  neutral_count int,
  move_on_count int,
  result text check (result in ('extend', 'move_on'))
);
create unique index extend_rounds_one_open on public.extend_rounds (board_id) where closed_at is null;
create index extend_rounds_topic_idx on public.extend_rounds (topic_id);

create table public.extend_votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.extend_rounds (id) on delete cascade,
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null,
  choice text not null check (choice in ('keep', 'neutral', 'move_on')),
  unique (round_id, user_id)
);
create index extend_votes_board_idx on public.extend_votes (board_id);

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  text text not null check (char_length(text) between 1 and 140),
  owner_name text check (char_length(owner_name) between 1 and 24),
  created_by uuid not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index actions_board_idx on public.actions (board_id);
create index actions_topic_idx on public.actions (topic_id);

create table public.takeaways (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null,
  author_name text not null check (char_length(author_name) between 1 and 24),
  text text check (char_length(text) between 1 and 200),
  passed boolean not null default false,
  unique (board_id, user_id),
  check (passed or text is not null)
);

-- Failed board lookups, passcode and recovery-token attempts, for throttling.
create table public.failed_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  board_id uuid references public.boards (id) on delete cascade,
  at timestamptz not null default now()
);
create index failed_attempts_user_idx on public.failed_attempts (user_id, at);
create index failed_attempts_at_idx on public.failed_attempts (at);
create index failed_attempts_board_idx on public.failed_attempts (board_id, at);

-- ---------------------------------------------------------------------------------------
-- Dot budget enforced as a constraint as well as in cast_dots().
-- ---------------------------------------------------------------------------------------
create function private.check_dot_budget() returns trigger
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
     and v.id <> new.id;

  if v_used + new.dots > v_budget then
    raise exception 'dot_budget_exceeded';
  end if;
  return new;
end;
$$;

create trigger votes_dot_budget
  before insert or update on public.votes
  for each row execute function private.check_dot_budget();

-- ---------------------------------------------------------------------------------------
-- Row-Level Security. Deny by default; only member-scoped SELECT policies.
-- ---------------------------------------------------------------------------------------
create function private.is_member(p_board uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participants p
     where p.board_id = p_board and p.user_id = (select auth.uid())
  );
$$;

create function private.can_see_topic(p_board uuid, p_author uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_member(p_board)
     and (
       p_author = (select auth.uid())
       or exists (
         select 1 from public.board_state s
          where s.board_id = p_board
            and (s.phase <> 'brainstorm' or not (s.settings ->> 'hide_topics')::boolean)
       )
     );
$$;

create function private.votes_visible(p_board uuid, p_round int) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.board_state s
     where s.board_id = p_board
       and (p_round < s.vote_round or s.votes_revealed_at is not null)
  );
$$;

create function private.extend_round_closed(p_round uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.extend_rounds r where r.id = p_round and r.closed_at is not null);
$$;

alter table public.boards enable row level security;
alter table public.board_state enable row level security;
alter table public.participants enable row level security;
alter table public.topics enable row level security;
alter table public.votes enable row level security;
alter table public.extend_rounds enable row level security;
alter table public.extend_votes enable row level security;
alter table public.actions enable row level security;
alter table public.takeaways enable row level security;
alter table public.failed_attempts enable row level security;

create policy board_state_members on public.board_state
  for select to authenticated using ((select private.is_member(board_id)));

create policy participants_members on public.participants
  for select to authenticated using ((select private.is_member(board_id)));

create policy topics_visible on public.topics
  for select to authenticated using (private.can_see_topic(board_id, author_user_id));

create policy votes_own_or_revealed on public.votes
  for select to authenticated using (
    (select private.is_member(board_id))
    and (user_id = (select auth.uid()) or private.votes_visible(board_id, round))
  );

create policy extend_rounds_members on public.extend_rounds
  for select to authenticated using ((select private.is_member(board_id)));

create policy extend_votes_own_or_closed on public.extend_votes
  for select to authenticated using (
    (select private.is_member(board_id))
    and (user_id = (select auth.uid()) or private.extend_round_closed(round_id))
  );

create policy actions_members on public.actions
  for select to authenticated using ((select private.is_member(board_id)));

create policy takeaways_members on public.takeaways
  for select to authenticated using ((select private.is_member(board_id)));

-- Table privileges: nothing for anon; SELECT only for authenticated on member tables.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.board_state, public.participants, public.topics, public.votes,
  public.extend_rounds, public.extend_votes, public.actions, public.takeaways to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid), private.can_see_topic(uuid, uuid),
  private.votes_visible(uuid, int), private.extend_round_closed(uuid) to authenticated;
