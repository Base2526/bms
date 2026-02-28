-- =========================
-- BANK ACCOUNTS: master
-- =========================
create table if not exists scam_bank_account (
  account_norm varchar(32) primary key,            -- digits only
  bank_name text null,                              -- optional display / last known
  report_count integer not null default 0,
  last_report_at timestamptz null,
  risk_level integer not null default 0,            -- 0-100
  tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  post_ids uuid[] not null default '{}',
  ctx jsonb null
);

create index if not exists idx_scam_bank_account_updated_at
  on scam_bank_account (updated_at desc);

create index if not exists idx_scam_bank_account_report_count
  on scam_bank_account (report_count desc);

-- optional: ถ้าอยากค้นหาแบบ LIKE prefix ได้เร็ว
create index if not exists idx_scam_bank_account_prefix
  on scam_bank_account (account_norm varchar_pattern_ops);

-- =========================
-- BANK ACCOUNTS: reports (event log)
-- =========================
create table if not exists scam_bank_account_report (
  id bigserial primary key,
  account_norm varchar(32) not null references scam_bank_account(account_norm) on delete cascade,
  bank_name text null,
  category text not null,                           -- SCAM | MONEY_MULE | SALES_ADS | DISPUTE | OTHER
  note text null,

  -- audit / meta
  user_id uuid null,                                -- เก็บ uid ได้ ถ้ามี login (แนะนำเก็บ แต่ไม่โชว์ public)
  client_id text null,
  device_model text null,
  os_version text null,
  app_version text null,
  local_blocked boolean not null default false,

  post_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bank_report_account_time
  on scam_bank_account_report (account_norm, created_at desc);

create index if not exists idx_bank_report_created_at
  on scam_bank_account_report (created_at desc);

create index if not exists idx_bank_report_user
  on scam_bank_account_report (user_id);

-- =========================
-- Upsert helper: update aggregates
-- =========================
create or replace function upsert_bank_account_aggregate()
returns trigger language plpgsql as $$
declare
  new_count integer;
  last_at timestamptz;
  risk integer;
begin
  -- ensure master exists
  insert into scam_bank_account(account_norm, bank_name)
  values (new.account_norm, new.bank_name)
  on conflict (account_norm) do update
    set bank_name = coalesce(excluded.bank_name, scam_bank_account.bank_name);

  select count(*), max(created_at)
    into new_count, last_at
  from scam_bank_account_report
  where account_norm = new.account_norm;

  -- simple risk model: clamp(report_count * 10)
  risk := greatest(0, least(100, new_count * 10));

  update scam_bank_account
  set report_count = new_count,
      last_report_at = last_at,
      risk_level = risk,
      updated_at = now()
  where account_norm = new.account_norm;

  return new;
end $$;

drop trigger if exists trg_bank_report_agg on scam_bank_account_report;
create trigger trg_bank_report_agg
after insert on scam_bank_account_report
for each row execute function upsert_bank_account_aggregate();
