-- Гардероб v1 — миграция базы. Схема: DATA.md (согласовано 2026-09-24).
-- Запускать целиком в SQL Editor проекта Supabase. Повторный запуск безопасен.

------------------------------------------------------------------
-- 1. Справочники (enum)
------------------------------------------------------------------
do $$ begin
  create type situation as enum ('gym','dog','office','weekend','evening');
exception when duplicate_object then null; end $$;

do $$ begin
  create type slot as enum ('base','layer2','outer','bottom','shoes','accessory');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_category as enum (
    'tshirt','longsleeve','polo','shirt','sweater','sweatshirt','hoodie','vest',
    'blazer','jacket','coat','suit',
    'jeans','trousers','shorts','sweatpants',
    'shoes','accessory');
exception when duplicate_object then null; end $$;

do $$ begin
  create type color as enum (
    'black','white','ecru','grey','navy','indigo','blue','teal',
    'olive','khaki','green','beige','brown','burgundy','red','yellow','pink','purple','multi');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pattern as enum ('solid','stripe','check','print','texture');
exception when duplicate_object then null; end $$;

do $$ begin
  create type logo_size as enum ('none','small','large');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_status as enum ('active','archived','out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type look_status as enum ('active','retired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type verdict as enum ('love','dislike');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rating_reason as enum
    ('hot','cold','wrong_situation','colors','not_my_style','uncomfortable');
exception when duplicate_object then null; end $$;

------------------------------------------------------------------
-- 2. Общая мелочь: автообновление updated_at
------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end $fn$;

------------------------------------------------------------------
-- 3. profiles
------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  display_name   text,
  current_season text not null default '2026-autumn',
  created_at     timestamptz not null default now()
);

-- профиль заводится сам в момент приглашения пользователя
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- и для тех, кого уже пригласили до миграции
insert into public.profiles (id, display_name)
select u.id, split_part(u.email, '@', 1) from auth.users u
on conflict (id) do nothing;

------------------------------------------------------------------
-- 4. items — вещь
------------------------------------------------------------------
create table if not exists public.items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_file     text not null,
  photo_path      text,
  title           text not null,
  brand           text,
  category        item_category not null,
  slots           slot[] not null,
  colors          color[] not null,
  pattern         pattern not null default 'solid',
  material        text,
  logo            logo_size not null default 'none',
  formality_min   int not null check (formality_min between 1 and 4),
  formality_max   int not null check (formality_max between 1 and 4),
  temp_min        int not null,
  temp_max        int not null,
  situations      situation[] not null default '{}',
  water_resistant boolean not null default false,
  wind_resistant  boolean not null default false,
  sleeveless      boolean not null default false,
  status          item_status not null default 'active',
  board_group     text,
  board_caption   text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint items_source_file_uniq unique (user_id, source_file),
  constraint items_formality_order check (formality_min <= formality_max),
  constraint items_temp_order check (temp_min <= temp_max),
  constraint items_slots_len check (array_length(slots, 1) between 1 and 3),
  constraint items_colors_len check (array_length(colors, 1) between 1 and 3)
);
comment on column public.items.source_file is 'имя оригинала в wardrobe-photos; по нему скил узнаёт вещь и не плодит дубли';
comment on column public.items.temp_min is 'комфорт в составе типичного лука, а не вещи самой по себе';

create index if not exists items_user_status_idx on public.items (user_id, status);

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

------------------------------------------------------------------
-- 5. looks — лук
------------------------------------------------------------------
create table if not exists public.looks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  season     text not null,
  situation  situation not null,
  temp_min   int not null,
  temp_max   int not null,
  rain_ok    boolean not null default false,
  why        text not null,
  batch      int not null default 1,
  status     look_status not null default 'active',
  created_at timestamptz not null default now(),
  constraint looks_temp_order check (temp_min <= temp_max)
);
comment on column public.looks.rain_ok is 'в луке есть рукава: хотя бы один слой не sleeveless; непромокаемость — плюс, но не условие';

create index if not exists looks_pick_idx
  on public.looks (user_id, season, situation, status, temp_min, temp_max);

------------------------------------------------------------------
-- 6. look_items — состав лука
------------------------------------------------------------------
create table if not exists public.look_items (
  look_id  uuid not null references public.looks(id) on delete cascade,
  item_id  uuid not null references public.items(id) on delete restrict,
  slot     slot not null,
  -- position в кавычках: без них парсер Postgres видит функцию position(x in y)
  position smallint not null default 0 check ("position" between 0 and 1),
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (look_id, slot, position)
);
comment on table public.look_items is 'item_id on delete restrict: вещь не удаляем, а переводим в статус out — иначе лук молча теряет слот';

create index if not exists look_items_item_idx on public.look_items (item_id);
create index if not exists look_items_user_idx on public.look_items (user_id);

------------------------------------------------------------------
-- 7. gaps — «чего не хватило»
------------------------------------------------------------------
create table if not exists public.gaps (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  season     text not null,
  situation  situation not null,
  temp_min   int not null,
  temp_max   int not null,
  rain_ok    boolean,
  missing    text not null,
  created_at timestamptz not null default now()
);
-- nulls not distinct: пробел «без уточнения про дождь» один на ячейку
create unique index if not exists gaps_cell_uniq
  on public.gaps (user_id, season, situation, temp_min, temp_max, rain_ok) nulls not distinct;

------------------------------------------------------------------
-- 8. ratings — оценка
------------------------------------------------------------------
create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  look_id    uuid not null references public.looks(id) on delete cascade,
  verdict    verdict not null,
  reasons    rating_reason[] not null default '{}',
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ratings_one_per_look unique (user_id, look_id),
  constraint ratings_reasons_only_for_dislike
    check (verdict = 'dislike' or coalesce(array_length(reasons, 1), 0) = 0)
);

drop trigger if exists ratings_touch on public.ratings;
create trigger ratings_touch before update on public.ratings
  for each row execute function public.touch_updated_at();

------------------------------------------------------------------
-- 9. wear_log — «надел сегодня»
------------------------------------------------------------------
create table if not exists public.wear_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  look_id    uuid not null references public.looks(id) on delete cascade,
  worn_on    date not null default current_date,
  temp_c     int,
  situation  situation,
  rain       boolean not null default false,
  created_at timestamptz not null default now(),
  constraint wear_log_one_per_day unique (user_id, look_id, worn_on)
);

------------------------------------------------------------------
-- 10. Правила доступа: каждая строка принадлежит своему пользователю
------------------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.items      enable row level security;
alter table public.looks      enable row level security;
alter table public.look_items enable row level security;
alter table public.gaps       enable row level security;
alter table public.ratings    enable row level security;
alter table public.wear_log   enable row level security;

do $pol$
declare t text;
begin
  foreach t in array array['items','looks','look_items','gaps','ratings','wear_log'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own', t);
  end loop;
end $pol$;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

grant select, insert, update, delete on
  public.profiles, public.items, public.looks, public.look_items,
  public.gaps, public.ratings, public.wear_log
  to authenticated;

------------------------------------------------------------------
-- 11. Приватный бакет с фото: {user_id}/items/{item_id}.webp
------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('wardrobe', 'wardrobe', false)
on conflict (id) do nothing;

drop policy if exists wardrobe_own_files on storage.objects;
create policy wardrobe_own_files on storage.objects for all to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text);
