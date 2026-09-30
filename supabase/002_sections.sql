-- Гардероб: разделы, сезоны и верификация (этап 4, правки от 2026-09-30).
-- Запускать целиком в SQL Editor проекта Supabase. Повторный запуск безопасен.
--
-- Что добавляется:
--   subcategory  — раздел 2 уровня (футболки, кроссовки, сумки…). Текст, а не enum:
--                  словарь живёт в приложении, чтобы переименовать раздел можно было
--                  без миграции.
--   seasons      — лето / осень-весна / зима. Отдельное поле, а не вычисление из
--                  температуры: владелец правит его руками при верификации.
--   verified     — карточку проверил человек. Пока false у всех 97 вещей: они и
--                  составляют список «Необходима верификация».
--   verified_at  — когда проверил.
--
-- Раздел 1 уровня (куртки / верх / низ / обувь / аксессуары) НЕ хранится:
-- он однозначно выводится из подраздела, словарь в docs/sections.js.
-- Слоты остаются как были: это роль вещи в луке, а не её тип.

------------------------------------------------------------------
-- 1. Сезон
------------------------------------------------------------------
do $$ begin
  create type season_tag as enum ('summer', 'demi', 'winter');
exception when duplicate_object then null; end $$;

comment on type season_tag is 'summer лето · demi осень-весна · winter зима';

------------------------------------------------------------------
-- 2. Новые поля вещи
------------------------------------------------------------------
alter table public.items add column if not exists subcategory text;
alter table public.items add column if not exists seasons     season_tag[] not null default '{}';
alter table public.items add column if not exists verified    boolean not null default false;
alter table public.items add column if not exists verified_at timestamptz;

comment on column public.items.subcategory is 'раздел 2 уровня; раздел 1 уровня выводится из него словарём в приложении';
comment on column public.items.seasons is 'лето / осень-весна / зима; заполняется человеком при верификации';
comment on column public.items.verified is 'false = вещь ждёт проверки владельцем и видна в списке «Необходима верификация»';

-- список «Необходима верификация» и сетка разделов — два самых частых запроса
create index if not exists items_verify_idx on public.items (user_id, verified);
create index if not exists items_subcategory_idx on public.items (user_id, subcategory);

------------------------------------------------------------------
-- 3. Отметка проверки ставится сама при правке карточки из приложения
------------------------------------------------------------------
create or replace function public.touch_verified_at()
returns trigger language plpgsql as $fn$
begin
  if new.verified and not old.verified then
    new.verified_at = now();
  elsif not new.verified then
    new.verified_at = null;
  end if;
  return new;
end $fn$;

drop trigger if exists items_verified_touch on public.items;
create trigger items_verified_touch before update on public.items
  for each row execute function public.touch_verified_at();
