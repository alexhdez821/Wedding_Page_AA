# RSVP System Integration Notes

## File placement
This implementation is wired for a static front-end + optional Supabase backend:

- `index.html`
  - Main wedding landing page.
  - Contains RSVP button links to `rsvp.html`.
- `rsvp.html`
  - Dedicated RSVP page and form UI.
  - Loads RSVP behavior via `<script type="module">`.
- `rsvp-data.js`
  - Local/mock guest list fallback when backend is not configured.
- `rsvp-config.js`
  - Backend config values (`supabaseUrl`, `supabaseAnonKey`, and table names).
- `rsvp-logic.js`
  - Guest lookup flow.
  - Party-based RSVP form rendering.
  - Backend save/check logic (Supabase REST API).
  - LocalStorage fallback for local testing.

## How the flow works
1. Guest clicks RSVP from the main page and opens `rsvp.html`.
2. Guest enters first + last name in the lookup form.
3. If `rsvp-config.js` is configured, lookup uses Supabase table data.
4. If not configured, lookup falls back to `rsvp-data.js` mock data.
5. Submission is stored in Supabase when configured.
6. Duplicate submissions are blocked by checking existing `party_id` responses.

## Backend setup (Supabase)

### 1) Create tables
Run this SQL in your Supabase SQL editor:

```sql
create table if not exists guest_parties (
  id text primary key,
  first_name text not null,
  last_name text not null,
  party_id text not null unique,
  invited_guests jsonb not null default '[]'::jsonb,
  can_bring_plus_one boolean not null default false,
  plus_one_name text,
  rsvp_status text not null default 'pending'
);

create table if not exists rsvp_responses (
  party_id text primary key,
  guest_id text not null,
  submitted_at timestamptz not null,
  invited_guests jsonb not null,
  can_bring_plus_one boolean not null,
  plus_one jsonb,
  dietary_restrictions text,
  guest_message text,
  rsvp_status text not null
);
```

### 2) Add initial guest data
Use `insert` statements with the same guest shape mapped to snake_case columns.

### 3) Configure front-end keys
Open `rsvp-config.js` and set:

- `supabaseUrl`
- `supabaseAnonKey`
- table names if you changed them

### 4) Set Row Level Security policies
You must add policies so the RSVP page can read guests and create/update responses.
At minimum:

- `select` on `guest_parties`
- `select`, `insert`, and `update` on `rsvp_responses`

> Important: keep guest table columns limited to RSVP-safe fields because anon users can query lookup data.

## Local fallback behavior
If backend config is empty, the app uses:

- `rsvp-data.js` for guest lookup
- browser `localStorage` for response storage

This is useful for development, but not for production tracking.


## New phone verification requirement

To support secure repeat lookups, the RSVP flow now stores a `phone` in `rsvp_responses` and verifies it before showing the wedding-details image.

If your table does not already include this column, run:

```sql
alter table rsvp_responses add column if not exists phone text;
```

The details image URL is currently configured in `rsvp-logic.js` as `WEDDING_DETAILS_IMAGE_URL`. Replace it with your private hosted invitation image.

## New shared-family RSVP requirement

If you want a known household (2+ named guests) to submit one shared RSVP, use a shared key for everyone in the household and define a per-household max capacity.

### 1) Add shared household key to guest list

```sql
alter table guest_list add column if not exists rsvp_pair_id text;
alter table guest_list add column if not exists max_guests integer;
```

For each known household, assign the same `rsvp_pair_id` value to all rows in that household. Leave it `null` for individual invites.
Set `max_guests` to the total number of guests allowed for that household (for example, `6` for a family invitation that may include children not already listed by name).

Example:

```sql
update guest_list
set rsvp_pair_id = 'family-garcia', max_guests = 4
where id in ('guest_mom_id', 'guest_dad_id');
```

> If you see `22P02: invalid input syntax for type uuid`, your `rsvp_pair_id` column is `uuid` (not `text`).
> In that case either:
>
> 1) use a real UUID value for each pair, for example:
>
> ```sql
> update guest_list
> set rsvp_pair_id = '8f1d3a57-35a4-4f8a-a557-2f2f4e5b9d10'
> where id in ('guest_a_id', 'guest_b_id');
> ```
>
> 2) or change the column type to `text` if you prefer human-readable IDs:
>
> ```sql
> alter table guest_list alter column rsvp_pair_id type text using rsvp_pair_id::text;
> ```

### 2) Store responses by response group and save additional guest names

```sql
alter table rsvp_responses add column if not exists response_group text;
alter table rsvp_responses add column if not exists additional_guest_names jsonb not null default '[]'::jsonb;

update rsvp_responses
set response_group = coalesce(response_group, 'guest:' || guest_id);

alter table rsvp_responses alter column response_group set not null;

create unique index if not exists rsvp_responses_response_group_idx
  on rsvp_responses (response_group);
```

The front-end now computes:
- `pair:<rsvp_pair_id>` for linked guests
- `guest:<guest_id>` for solo guests

This allows any member of a linked household to find the invitation and submit once, while still limiting one final RSVP per response group.

## Private pending-actions page

The repository now includes `pending-actions.html`, a private-by-obscurity page for Alejandro and Alejandra to manage wedding tasks together. It is intentionally not linked from `index.html` and includes a `noindex` meta tag, so the only people who should know it exists are the people who receive the exact URL.

> Important: an unlinked static HTML page is not the same thing as authentication. Anyone with the exact URL can open it. If you need stronger privacy, put the site behind host-level password protection or add a real authenticated backend.

### Shared editing URL

Use a shared list key in the URL so both browsers load the same task list:

```text
https://your-domain.com/pending-actions.html?list=choose-a-long-private-key
```

Replace `choose-a-long-private-key` with a long, hard-to-guess phrase. Share that exact URL only between the two of you. If no `list` value is provided, the page uses a default local list key.

### Supabase table for shared tasks

If `rsvp-config.js` has your Supabase URL and anon key, create this table so tasks sync between both of your devices:

```sql
create table if not exists wedding_actions (
  id uuid primary key default gen_random_uuid(),
  list_key text not null,
  title text not null,
  notes text not null default '',
  assignee text not null default 'Both',
  due_date date,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wedding_actions_list_key_idx
  on wedding_actions (list_key);
```

### Row Level Security policies

For a simple private-by-obscurity setup, enable Row Level Security and allow the public anon key to operate on this table. The page always filters updates/deletes by `list_key` and `id`, but this is still not a replacement for real authentication.

```sql
alter table wedding_actions enable row level security;

create policy "Allow anon wedding action reads"
  on wedding_actions for select
  to anon
  using (true);

create policy "Allow anon wedding action inserts"
  on wedding_actions for insert
  to anon
  with check (true);

create policy "Allow anon wedding action updates"
  on wedding_actions for update
  to anon
  using (true)
  with check (true);

create policy "Allow anon wedding action deletes"
  on wedding_actions for delete
  to anon
  using (true);
```

### Local fallback

If Supabase is not configured or unavailable, `pending-actions.html` still works with browser `localStorage`, but changes will only exist on that one browser/device and will not sync between you.
