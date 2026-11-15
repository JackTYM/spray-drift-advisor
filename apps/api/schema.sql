create table if not exists readings (
  id bigserial primary key,
  source text not null,
  kind text not null,
  block_id text not null,
  time timestamptz not null,
  levels jsonb not null
);
create index if not exists readings_block_time on readings (block_id, time desc);

create table if not exists evaluations (
  id bigserial primary key,
  reading_id bigint references readings (id) on delete cascade,
  block_id text not null,
  time timestamptz not null,
  status text not null,
  ground_status text not null,
  delta_f real not null,
  ri real not null,
  triggers jsonb not null,
  session_id text
);
create index if not exists evaluations_block on evaluations (block_id, id desc);
create index if not exists evaluations_session on evaluations (session_id);

create table if not exists sessions (
  id text primary key,
  block_id text not null,
  phase text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  override_reason text,
  state jsonb not null
);

create table if not exists alerts (
  id bigserial primary key,
  session_id text,
  block_id text not null,
  kind text not null,
  channel text not null,
  recipient text not null,
  time timestamptz not null default now(),
  ok boolean not null,
  detail text,
  title text not null,
  body text not null
);

create table if not exists recorded_tower (
  id bigserial primary key,
  source text not null,
  block_id text not null,
  time timestamptz not null,
  levels jsonb not null
);

create table if not exists weather_cache (
  key text primary key,
  fetched_at timestamptz not null,
  payload jsonb not null
);

create table if not exists backtest_results (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  label text not null,
  result jsonb not null
);

create table if not exists push_subscriptions (
  endpoint text primary key,
  role text not null,
  subscription jsonb not null
);
