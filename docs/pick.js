// Экран «Подобрать» и экран лука: оценка ❤️/👎 и кнопка «Надел сегодня».
import {
  sb, state, SITUATIONS, SLOTS, REASONS,
  el, $, clear, toast, showScreen, photoUrls, photoImg,
  labelOf, tempLabel, todayISO, errText, prefs,
} from './lib.js';

const LOOK_SELECT =
  'id, season, situation, temp_min, temp_max, rain_ok, why, batch, ' +
  'look_items ( slot, position, items ( id, title, brand, category, photo_path ) )';

const ctx = {
  temp: prefs.get('temp', 12),
  situation: prefs.get('situation', 'weekend'),
  rain: prefs.get('rain', false),
};

let lastResults = [];

export function initPick() {
  $('#temp').value = ctx.temp;
  $('#rain').checked = ctx.rain;

  $('#temp').addEventListener('change', () => setTemp(parseInt($('#temp').value, 10)));
  $('#temp-minus').addEventListener('click', () => setTemp(ctx.temp - 1));
  $('#temp-plus').addEventListener('click', () => setTemp(ctx.temp + 1));
  $('#rain').addEventListener('change', () => { ctx.rain = $('#rain').checked; prefs.set('rain', ctx.rain); });
  $('#btn-pick').addEventListener('click', runPick);
  $('#look-back').addEventListener('click', () => showScreen('pick'));

  const box = clear($('#situations'));
  for (const s of SITUATIONS) {
    box.append(el('button', {
      class: 'chip' + (s.id === ctx.situation ? ' is-on' : ''),
      type: 'button',
      dataset: { sit: s.id },
      text: s.label,
      onclick: () => {
        ctx.situation = s.id;
        prefs.set('situation', s.id);
        for (const c of box.children) c.classList.toggle('is-on', c.dataset.sit === s.id);
        runPick();
      },
    }));
  }
}

function setTemp(value) {
  if (!Number.isFinite(value)) value = 12;
  ctx.temp = Math.max(-30, Math.min(40, value));
  $('#temp').value = ctx.temp;
  prefs.set('temp', ctx.temp);
}

// ------------------------------------------------------------------ подбор

async function fetchLooks({ spread = 0 }) {
  let q = sb.from('looks').select(LOOK_SELECT)
    .eq('season', state.season)
    .eq('situation', ctx.situation)
    .eq('status', 'active')
    .lte('temp_min', ctx.temp + spread)
    .gte('temp_max', ctx.temp - spread);
  if (ctx.rain) q = q.eq('rain_ok', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function fetchGaps() {
  let q = sb.from('gaps').select('*')
    .eq('season', state.season)
    .eq('situation', ctx.situation)
    .lte('temp_min', ctx.temp)
    .gte('temp_max', ctx.temp);
  const { data, error } = await q;
  if (error) throw error;
  let rows = data || [];
  if (ctx.rain) {
    const rainy = rows.filter((g) => g.rain_ok !== false);
    if (rainy.length) rows = rainy;
  }
  return rows;
}

async function loadRatings(ids) {
  if (!ids.length) return;
  const { data, error } = await sb.from('ratings').select('look_id, verdict, reasons, comment').in('look_id', ids);
  if (error) { console.warn('ratings', error); return; }
  for (const r of data || []) state.ratings.set(r.look_id, r);
}

export async function runPick() {
  const box = clear($('#pick-results'));
  box.append(el('div', { class: 'skeleton' }));

  try {
    const exact = await fetchLooks({ spread: 0 });
    let rows = exact.map((l) => ({ look: l, border: false }));

    if (rows.length < 2) {
      const near = await fetchLooks({ spread: 5 });
      for (const l of near) {
        if (!rows.some((r) => r.look.id === l.id)) rows.push({ look: l, border: true });
      }
    }

    await loadRatings(rows.map((r) => r.look.id));

    rows.sort((a, b) => {
      const weight = (r) => (r.border ? 2 : 0) + (state.ratings.get(r.look.id)?.verdict === 'dislike' ? 1 : 0);
      const d = weight(a) - weight(b);
      return d !== 0 ? d : Math.random() - 0.5; // между заходами варианты перемешиваются
    });
    rows = rows.slice(0, 3);
    lastResults = rows;

    clear(box);
    if (!rows.length) {
      await renderEmpty(box);
      return;
    }

    const urls = await photoUrls(rows.flatMap((r) => (r.look.look_items || []).map((li) => li.items?.photo_path)));
    for (const row of rows) box.append(lookCard(row, urls));
  } catch (e) {
    clear(box).append(el('p', { class: 'msg err', text: errText(e) }));
  }
}

async function renderEmpty(box) {
  const sit = labelOf(SITUATIONS, ctx.situation);
  const gaps = await fetchGaps().catch(() => []);
  box.append(el('div', { class: 'empty' }, [
    el('p', { text: `На ${ctx.temp > 0 ? '+' : ''}${ctx.temp}° в ситуации «${sit}»${ctx.rain ? ' в дождь' : ''} луков пока нет.` }),
  ]));
  for (const g of gaps) {
    box.append(el('div', { class: 'gap-card' }, [
      el('strong', { text: 'Чего не хватает' }),
      el('p', { class: 'small', style: 'margin:6px 0 0', text: g.missing }),
      el('p', { class: 'muted small', style: 'margin:6px 0 0', text: `${sit} · ${tempLabel(g.temp_min, g.temp_max)}` }),
    ]));
  }
  if (!gaps.length) {
    box.append(el('p', { class: 'muted small', style: 'text-align:center', text: 'Луки на этот сезон ещё не собраны — это следующий шаг в Claude Code.' }));
  }
}

function sortedLookItems(look) {
  const order = SLOTS.map((s) => s.id);
  return [...(look.look_items || [])]
    .filter((li) => li.items)
    .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot) || a.position - b.position);
}

function badgesFor(row) {
  const out = [];
  if (row.border) out.push(el('span', { class: 'badge', text: 'на границе диапазона' }));
  if (row.look.rain_ok) out.push(el('span', { class: 'badge', text: 'годится в дождь' }));
  const rated = state.ratings.get(row.look.id);
  if (rated) out.push(el('span', { class: 'badge badge-rated', text: rated.verdict === 'love' ? '❤️ понравился' : '👎 отклонён' }));
  return out;
}

function lookCard(row, urls) {
  const items = sortedLookItems(row.look);
  const collage = el('div', { class: 'collage mini' },
    items.slice(0, 8).map((li) => el('figure', {}, [photoImg(urls.get(li.items.photo_path), li.items.title)])));

  const card = el('button', { class: 'look-card', type: 'button', onclick: () => openLook(row) }, [
    el('div', { class: 'badges' }, badgesFor(row)),
    collage,
    el('div', { class: 'why', text: row.look.why }),
  ]);
  card.__lookId = row.look.id;
  return card;
}

// ------------------------------------------------------------------ экран лука

export async function openLook(row) {
  const look = row.look;
  showScreen('look');
  $('#look-title').textContent = `${labelOf(SITUATIONS, look.situation)} · ${tempLabel(look.temp_min, look.temp_max)}`;
  const body = clear($('#look-body'));
  body.append(el('div', { class: 'skeleton' }));

  const items = sortedLookItems(look);
  const urls = await photoUrls(items.map((li) => li.items.photo_path));
  clear(body);

  body.append(el('div', { class: 'badges', style: 'padding-left:0' }, badgesFor(row)));
  body.append(el('div', { class: 'collage' },
    items.map((li) => el('figure', {}, [photoImg(urls.get(li.items.photo_path), li.items.title)]))));
  body.append(el('p', { class: 'why-big', text: look.why }));
  body.append(el('ul', { class: 'look-items' }, items.map((li) => el('li', {}, [
    el('span', { class: 'slot', text: labelOf(SLOTS, li.slot) }),
    el('span', { text: li.items.title }),
  ]))));

  body.append(wearButton(look));
  body.append(ratingBlock(look));
}

function wearButton(look) {
  const btn = el('button', { class: 'btn btn-wide', style: 'margin-top:18px' }, ['Надел сегодня']);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const { error } = await sb.from('wear_log').upsert({
      user_id: state.user.id,
      look_id: look.id,
      worn_on: todayISO(),
      temp_c: ctx.temp,
      situation: look.situation,
      rain: ctx.rain,
    }, { onConflict: 'user_id,look_id,worn_on' });
    btn.disabled = false;
    if (error) { toast(errText(error)); return; }
    btn.textContent = 'Записано ✓';
    toast('Записал: надел сегодня');
  });
  return btn;
}

function ratingBlock(look) {
  const saved = state.ratings.get(look.id) || null;
  const draft = {
    verdict: saved?.verdict || null,
    reasons: new Set(saved?.reasons || []),
    comment: saved?.comment || '',
  };

  const box = el('div', { style: 'margin-top:8px' });
  const love = el('button', { class: 'rate-btn', type: 'button' }, ['❤️']);
  const nope = el('button', { class: 'rate-btn', type: 'button' }, ['👎']);
  box.append(el('div', { class: 'rate-row' }, [love, nope]));

  const extra = el('div', { class: 'stack' });
  box.append(extra);

  const reasonsBox = el('div', { class: 'chips' }, REASONS.map((r) => el('button', {
    class: 'chip chip-small' + (draft.reasons.has(r.id) ? ' is-on' : ''),
    type: 'button',
    onclick: (e) => {
      if (draft.reasons.has(r.id)) draft.reasons.delete(r.id); else draft.reasons.add(r.id);
      e.currentTarget.classList.toggle('is-on', draft.reasons.has(r.id));
    },
  }, [r.label])));

  const comment = el('textarea', { placeholder: 'Комментарий (по желанию)', rows: 3 });
  comment.value = draft.comment;
  const commentField = el('label', { class: 'field' }, [el('span', { text: 'Комментарий' }), comment]);

  const save = el('button', { class: 'btn btn-primary btn-wide' }, ['Сохранить оценку']);
  save.addEventListener('click', async () => {
    if (!draft.verdict) { toast('Сначала ❤️ или 👎'); return; }
    save.disabled = true;
    const payload = {
      user_id: state.user.id,
      look_id: look.id,
      verdict: draft.verdict,
      reasons: draft.verdict === 'dislike' ? [...draft.reasons] : [],
      comment: comment.value.trim() || null,
    };
    const { error } = await sb.from('ratings').upsert(payload, { onConflict: 'user_id,look_id' });
    save.disabled = false;
    if (error) { toast(errText(error)); return; }
    state.ratings.set(look.id, payload);
    toast('Оценка сохранена');
    showScreen('pick');
    const card = lastResults.find((r) => r.look.id === look.id);
    if (card) refreshBadges(card);
  });

  function paint() {
    love.classList.toggle('is-on', draft.verdict === 'love');
    nope.classList.toggle('is-on', draft.verdict === 'dislike');
    clear(extra);
    if (!draft.verdict) return;
    if (draft.verdict === 'dislike') {
      extra.append(el('p', { class: 'muted small', style: 'margin:0', text: 'Что не так?' }), reasonsBox);
    }
    extra.append(commentField, save);
  }

  love.addEventListener('click', () => { draft.verdict = 'love'; draft.reasons.clear(); paint(); });
  nope.addEventListener('click', () => { draft.verdict = 'dislike'; paint(); });
  paint();
  return box;
}

/** После оценки обновляем значок на карточке в списке подбора, не перезапрашивая базу. */
function refreshBadges(row) {
  for (const card of $('#pick-results').children) {
    if (card.__lookId === row.look.id) clear(card.querySelector('.badges')).append(...badgesFor(row));
  }
}
