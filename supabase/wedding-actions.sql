-- Supabase setup for pending-actions.html
-- Run this in your Supabase project SQL Editor.
--
-- Privacy model:
-- This is "private by exact link." The table itself is not exposed to the public
-- anon role. Instead, the page calls RPC functions with the long ?list=... key.
-- Anyone who has that exact key can access that list, so choose a long,
-- hard-to-guess value and do not share it publicly.

create table if not exists public.wedding_actions (
  id uuid primary key default gen_random_uuid(),
  list_key text not null,
  title text not null,
  notes text not null default '',
  assignee text not null default 'Both',
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wedding_actions_list_key_idx
  on public.wedding_actions (list_key);

create index if not exists wedding_actions_list_status_due_idx
  on public.wedding_actions (list_key, status, due_date, created_at desc);

alter table public.wedding_actions enable row level security;

-- Do not expose the table directly through the public anon key.
revoke all on table public.wedding_actions from anon;
revoke all on table public.wedding_actions from authenticated;

-- Re-run safe: replace functions so this file can be applied more than once.
drop function if exists public.get_wedding_actions(text);
drop function if exists public.upsert_wedding_action(uuid, text, text, text, text, date, text);
drop function if exists public.delete_wedding_action(uuid, text);

create or replace function public.get_wedding_actions(p_list_key text)
returns setof public.wedding_actions
language sql
security definer
set search_path = public
as $$
  select *
  from public.wedding_actions
  where list_key = p_list_key
    and length(trim(p_list_key)) >= 24
  order by status asc, due_date asc nulls last, created_at desc;
$$;

create or replace function public.upsert_wedding_action(
  p_id uuid,
  p_list_key text,
  p_title text,
  p_notes text default '',
  p_assignee text default 'Both',
  p_due_date date default null,
  p_status text default 'open'
)
returns setof public.wedding_actions
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(trim(p_list_key)) < 24 then
    raise exception 'List key must be at least 24 characters long.';
  end if;

  if p_status not in ('open', 'done') then
    raise exception 'Invalid status.';
  end if;

  insert into public.wedding_actions (
    id,
    list_key,
    title,
    notes,
    assignee,
    due_date,
    status,
    created_at,
    updated_at
  ) values (
    p_id,
    p_list_key,
    nullif(trim(p_title), ''),
    coalesce(p_notes, ''),
    coalesce(nullif(trim(p_assignee), ''), 'Both'),
    p_due_date,
    p_status,
    now(),
    now()
  )
  on conflict (id) do update set
    title = excluded.title,
    notes = excluded.notes,
    assignee = excluded.assignee,
    due_date = excluded.due_date,
    status = excluded.status,
    updated_at = now()
  where public.wedding_actions.list_key = p_list_key;

  return query
    select *
    from public.wedding_actions
    where id = p_id
      and list_key = p_list_key;
end;
$$;

create or replace function public.delete_wedding_action(
  p_id uuid,
  p_list_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(trim(p_list_key)) < 24 then
    raise exception 'List key must be at least 24 characters long.';
  end if;

  delete from public.wedding_actions
  where id = p_id
    and list_key = p_list_key;
end;
$$;

grant usage on schema public to anon;
grant execute on function public.get_wedding_actions(text) to anon;
grant execute on function public.upsert_wedding_action(uuid, text, text, text, text, date, text) to anon;
grant execute on function public.delete_wedding_action(uuid, text) to anon;
