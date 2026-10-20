-- 004: комментарий к луку без оценки + варианты замены вещи в луке.
-- Выполняется в SQL-редакторе Supabase поверх 001–003. Запускать можно повторно.

------------------------------------------------------------------
-- 1. Комментарий без ❤️/👎
------------------------------------------------------------------
-- Раньше строка оценки не могла существовать без вердикта, поэтому просто
-- записать мысль о луке было нельзя. Теперь вердикт необязателен, но пустая
-- строка (ни оценки, ни текста) по-прежнему не имеет смысла и запрещена.

alter table public.ratings alter column verdict drop not null;

alter table public.ratings drop constraint if exists ratings_reasons_only_for_dislike;
alter table public.ratings add constraint ratings_reasons_only_for_dislike
  check (coalesce(array_length(reasons, 1), 0) = 0 or verdict is not distinct from 'dislike');

alter table public.ratings drop constraint if exists ratings_not_empty;
alter table public.ratings add constraint ratings_not_empty
  check (verdict is not null or nullif(btrim(coalesce(comment, '')), '') is not null);

comment on column public.ratings.verdict is
  'null — владелец оставил только комментарий, без ❤️/👎';

------------------------------------------------------------------
-- 2. Замена вещи в луке: помним, что предлагал Claude
------------------------------------------------------------------
-- Намеренно без references на items: вторая ссылка на ту же таблицу сделала бы
-- запрос look_items → items неоднозначным для PostgREST, а приложение тянет состав
-- лука именно так. Вещи мы не удаляем (статус out), поэтому целостность тут не нужна.
alter table public.look_items
  add column if not exists original_item_id uuid;

comment on column public.look_items.original_item_id is
  'Что стояло в слоте изначально, если владелец заменил вещь в приложении. null — состав не трогали. На этапе 6 это самый сильный сигнал: сильнее, чем 👎';

------------------------------------------------------------------
-- 3. look_alts — варианты замены, которые предложил Claude
------------------------------------------------------------------
-- Не автоподбор по гардеробу: в каждом слоте один-два заранее выбранных
-- варианта, собранных вместе с луком и проверенных теми же правилами.
-- В приложении они листаются стрелками под увеличенным фото.

create table if not exists public.look_alts (
  look_id    uuid not null references public.looks(id) on delete cascade,
  slot       slot not null,
  -- position в кавычках: без них парсер Postgres видит функцию position(x in y)
  position   smallint not null default 0 check ("position" between 0 and 1),
  item_id    uuid not null references public.items(id) on delete cascade,
  rank       smallint not null default 0 check (rank between 0 and 1),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (look_id, slot, "position", item_id)
);

comment on table public.look_alts is
  'Варианты замены для слота лука: до двух на слот, порядок — rank. Вещь из look_items здесь не повторяется';

create index if not exists look_alts_look_idx on public.look_alts (look_id);

alter table public.look_alts enable row level security;

drop policy if exists look_alts_own on public.look_alts;
create policy look_alts_own on public.look_alts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.look_alts to authenticated;
