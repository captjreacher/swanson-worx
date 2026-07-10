-- Swanson Worx — booking-request intake.
-- Records a booking REQUEST only (not a confirmed booking).
-- Writes come exclusively from the Cloudflare Worker using the Supabase service-role key.

create table if not exists public.swanson_worx_booking_requests (
  id                    uuid primary key default gen_random_uuid(),
  booking_reference     text unique not null,
  created_at            timestamptz not null default now(),
  customer_name         text not null,
  customer_phone        text not null,
  customer_email        text not null,
  customer_notes        text,
  vehicle_year          text,
  vehicle_make          text not null,
  vehicle_model         text not null,
  vehicle_registration  text,
  services              jsonb not null,
  preferred_slot        text not null,
  indicative_estimate   numeric(10,2),
  status                text not null default 'received',
  source                text not null default 'swanson-worx-staging',
  request_ip_hash       text,
  user_agent            text
);

create index if not exists swanson_worx_booking_requests_created_at_idx
  on public.swanson_worx_booking_requests (created_at desc);

-- Lock the table down. RLS is enabled with NO policies, so anon/authenticated browser
-- clients can neither read nor insert. The Worker's service-role key bypasses RLS.
-- Do NOT add public/anon insert policies.
alter table public.swanson_worx_booking_requests enable row level security;
