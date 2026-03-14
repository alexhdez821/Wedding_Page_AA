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
