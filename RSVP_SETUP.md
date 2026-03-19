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


## New email verification requirement

To support secure repeat lookups, the RSVP flow now stores an `email` in `rsvp_responses` and verifies it before showing the wedding-details image.

If your table does not already include this column, run:

```sql
alter table rsvp_responses add column if not exists email text;
```

The details image URL is currently configured in `rsvp-logic.js` as `WEDDING_DETAILS_IMAGE_URL`. Replace it with your private hosted invitation image.

## New party-of-2 shared RSVP requirement

If you want either person in a known pair to submit one shared RSVP (party size of 2 max), add a shared key to both guests and store responses by that key.

### 1) Add shared pair key to guest list

```sql
alter table guest_list add column if not exists rsvp_pair_id text;
```

For each known pair, assign the same `rsvp_pair_id` value to both rows. Leave it `null` for individual invites.

Example:

```sql
update guest_list set rsvp_pair_id = 'pair-ana-luis' where id in ('guest_a_id', 'guest_b_id');
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

### 2) Store responses by response group

```sql
alter table rsvp_responses add column if not exists response_group text;

update rsvp_responses
set response_group = coalesce(response_group, 'guest:' || guest_id);

alter table rsvp_responses alter column response_group set not null;

create unique index if not exists rsvp_responses_response_group_idx
  on rsvp_responses (response_group);
```

The front-end now computes:
- `pair:<rsvp_pair_id>` for linked guests
- `guest:<guest_id>` for solo guests

This allows either member of a linked pair to find the invitation and submit once, while still limiting one final RSVP per pair.
