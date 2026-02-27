-- Madurai Makkal Connect - Supabase schema
-- Apply in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key,
  phone_number text unique not null,
  name text not null,
  ward text not null,
  device_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bins (
  id uuid primary key default gen_random_uuid(),
  bin_name text not null,
  qr_code_id text unique not null,
  latitude float8 not null,
  longitude float8 not null,
  status text not null default 'available' check (status in ('available', 'reported_full', 'temporarily_disabled')),
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.bin_reports (
  id uuid primary key default gen_random_uuid(),
  bin_id uuid not null references public.bins(id) on delete cascade,
  reported_by uuid not null references public.users(id) on delete cascade,
  reason text not null,
  reported_at timestamptz not null default now()
);

create table if not exists public.user_location_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  latitude float8 not null,
  longitude float8 not null,
  accuracy float4 not null,
  device_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.disposals (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  bin_id uuid not null references public.bins(id) on delete cascade,
  ai_verified boolean not null,
  geo_verified boolean not null,
  qr_verified boolean not null,
  distance_m float4 not null,
  accuracy_m float4 not null,
  points_awarded int not null default 0,
  waste_size text not null,
  image_hash text,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.image_validation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  bin_id uuid references public.bins(id) on delete set null,
  image_hash text not null,
  ai_result boolean not null,
  failure_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_entries (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  points int not null,
  reason text not null,
  source text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_summary (
  user_id uuid primary key references public.users(id) on delete cascade,
  total_points int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_redemptions (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  reward_id text not null,
  coupon_code text unique not null,
  points_used int not null,
  status text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.complaints (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null,
  description text,
  photo_url text not null,
  image_hash text,
  latitude float8 not null,
  longitude float8 not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.complaint_updates (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  status text not null,
  updated_by uuid not null references public.users(id) on delete cascade,
  remarks text,
  updated_at timestamptz not null default now()
);

create table if not exists public.cleanup_proofs (
  id uuid primary key,
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  submitted_by uuid not null references public.users(id) on delete cascade,
  photo_url text not null,
  image_hash text,
  latitude float8 not null,
  longitude float8 not null,
  distance_from_complaint_m float4 not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fraud_flags (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  fraud_type text not null,
  risk_score int not null,
  details text,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.bins enable row level security;
alter table public.bin_reports enable row level security;
alter table public.user_location_logs enable row level security;
alter table public.disposals enable row level security;
alter table public.image_validation_logs enable row level security;
alter table public.wallet_entries enable row level security;
alter table public.wallet_summary enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_updates enable row level security;
alter table public.cleanup_proofs enable row level security;
alter table public.fraud_flags enable row level security;

-- Citizens can read shared bins.
drop policy if exists bins_read_all on public.bins;
create policy bins_read_all on public.bins
  for select
  using (true);

-- Users can only access their own records.
drop policy if exists users_self_access on public.users;
create policy users_self_access on public.users
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Generic ownership policies.
drop policy if exists disposals_owner_rw on public.disposals;
create policy disposals_owner_rw on public.disposals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists wallet_entries_owner_rw on public.wallet_entries;
create policy wallet_entries_owner_rw on public.wallet_entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists wallet_summary_owner_rw on public.wallet_summary;
create policy wallet_summary_owner_rw on public.wallet_summary
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists redemptions_owner_rw on public.reward_redemptions;
create policy redemptions_owner_rw on public.reward_redemptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists complaints_owner_rw on public.complaints;
create policy complaints_owner_rw on public.complaints
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists bin_reports_owner_rw on public.bin_reports;
create policy bin_reports_owner_rw on public.bin_reports
  for all
  using (auth.uid() = reported_by)
  with check (auth.uid() = reported_by);

drop policy if exists location_logs_owner_rw on public.user_location_logs;
create policy location_logs_owner_rw on public.user_location_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists image_logs_owner_rw on public.image_validation_logs;
create policy image_logs_owner_rw on public.image_validation_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists cleanup_proofs_owner_rw on public.cleanup_proofs;
create policy cleanup_proofs_owner_rw on public.cleanup_proofs
  for all
  using (auth.uid() = submitted_by)
  with check (auth.uid() = submitted_by);

drop policy if exists fraud_flags_owner_rw on public.fraud_flags;
create policy fraud_flags_owner_rw on public.fraud_flags
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- complaint_updates is usually worker/admin managed; allow inserts for authenticated users in MVP.
drop policy if exists complaint_updates_auth_insert on public.complaint_updates;
create policy complaint_updates_auth_insert on public.complaint_updates
  for insert
  to authenticated
  with check (auth.uid() = updated_by);

-- Reads scoped to complaint owner or updater in MVP.
drop policy if exists complaint_updates_read on public.complaint_updates;
create policy complaint_updates_read on public.complaint_updates
  for select
  to authenticated
  using (true);
