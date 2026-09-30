// Экран «Гардероб»: разделы двух уровней, фильтры и список «Необходима верификация».
import {
  sb, state, SITUATIONS, COLORS, STATUSES,
  el, $, clear, photoUrls, photoImg, labelOf, errText, prefs,
} from './lib.js';
import { SECTIONS, SEASONS, subOfItem, subLabel, sectionOf } from './sections.js';
import { openItem, setItemContext, initZoom } from './item.js';

const filters = {
  sub: prefs.get('wd-sub', null),
  status: prefs.get('wd-status', 'all'),
  seasons: new Set(prefs.get('wd-seasons', [])),
  colors: new Set(prefs.get('wd-colors', [])),
  situation: prefs.get('wd-situation', 'all'),
  unverifiedOnly: false,
  query: '',
};

let urls = new Map();
let collapsed = new Set(prefs.get('wd-collapsed', []));

function saveFilters() {
  prefs.set('wd-sub', filters.sub);
  prefs.set('wd-status', filters.status);
  prefs.set('wd-seasons', [...filters.seasons]);
  prefs.set('wd-colors', [...filters.colors]);
  prefs.set('wd-situation', filters.situation);
}

export function initWardrobe() {
  $('#wd-search').addEventListener('input', (e) => {
    filters.query = e.target.value.trim().toLowerCase();
    render();
  });
  $('#btn-more-filters').addEventListener('click', openFilters);
  $('#filters-reset').addEventListener('click', () => {
    filters.status = 'all';
    filters.seasons.clear();
    filters.colors.clear();
    filters.situation = 'all';
    saveFilters();
    openFilters();
    render();
  });
  initZoom();
  setItemContext({ photoUrlMap: urls, afterSave: render });
}

export async function loadItems(force = false) {
  if (state.items && !force) return state.items;
  const { data, error } = await sb.from('items').select('*').order('title');
  if (error) throw error;
  state.items = data || [];
  const fresh = await photoUrls(state.items.map((i) => i.photo_path));
  urls.clear();
  for (const [k, v] of fresh) urls.set(k, v);
  return state.items;
}

export async function showWardrobe() {
  const box = clear($('#wd-groups'));
  box.append(el('div', { class: 'skeleton' }));
  try {
    await loadItems();
    render();
  } catch (e) {
    clear(box).append(el('p', { class: 'msg err', text: errText(e) }));
  }
}

// ------------------------------------------------------------------ отбор

/** Всё, кроме фильтра по подразделу: по этому набору считаются цифры в полоске разделов. */
function matchesCommon(i) {
  if (filters.unverifiedOnly && i.verified) return false;
  if (filters.status !== 'all' && i.status !== filters.status) return false;
  if (filters.situation !== 'all' && !(i.situations || []).includes(filters.situation)) return false;
  if (filters.seasons.size && !(i.seasons || []).some((s) => filters.seasons.has(s))) return false;
  if (filters.colors.size && !(i.colors || []).some((c) => filters.colors.has(c))) return false;
  if (filters.query) {
    const hay = `${i.title} ${i.brand || ''} ${subLabel(subOfItem(i))}`.toLowerCase();
    if (!hay.includes(filters.query)) return false;
  }
  return true;
}

const visibleItems = () => (state.items || []).filter(matchesCommon);

// ------------------------------------------------------------------ отрисовка

function render() {
  const rows = visibleItems();
  renderVerifyRow();
  renderSectionBar(rows);
  renderActiveFilters();

  const shown = filters.sub ? rows.filter((i) => subOfItem(i) === filters.sub) : rows;
  $('#wd-count').textContent = `${shown.length} из ${(state.items || []).length} вещей`;

  const box = clear($('#wd-groups'));
  if (!shown.length) {
    box.append(el('p', { class: 'empty', text: 'Ничего не нашлось' }));
    return;
  }

  // группировка по подразделу, порядок — как в справочнике
  const order = SECTIONS.flatMap((s) => s.subs.map((x) => x.id));
  const groups = new Map();
  for (const item of shown) {
    const sub = subOfItem(item) || 'unknown';
    if (!groups.has(sub)) groups.set(sub, []);
    groups.get(sub).push(item);
  }
  const sorted = [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));

  for (const [sub, items] of sorted) {
    const isCollapsed = collapsed.has(sub);
    const head = el('button', {
      class: 'group-head', type: 'button', dataset: { section: sectionOf(sub) || '' },
      onclick: () => {
        if (collapsed.has(sub)) collapsed.delete(sub); else collapsed.add(sub);
        prefs.set('wd-collapsed', [...collapsed]);
        render();
      },
    }, [
      el('span', { class: 'group-name', text: subLabel(sub) }),
      el('span', { class: 'group-count', text: String(items.length) }),
      el('span', { class: 'group-chevron', text: isCollapsed ? '▸' : '▾' }),
    ]);

    const grid = el('div', { class: 'grid' }, isCollapsed ? [] : items.map(itemCard));
    box.append(el('section', { class: 'wd-group', dataset: { sub } }, [head, grid]));
  }

  measureHead();
  currentSection = null;
  onScroll();
}

/** Заголовки разделов липнут ровно под шапкой, какой бы высоты она ни получилась. */
function measureHead() {
  const head = $('#wd-sticky');
  if (!head) return;
  document.documentElement.style.setProperty('--head-h', `${Math.round(head.getBoundingClientRect().height)}px`);
}
window.addEventListener('resize', measureHead);

function itemCard(item) {
  return el('button', {
    class: 'item-card' + (item.status === 'active' ? '' : ' is-off'),
    type: 'button',
    onclick: () => openItem(item),
  }, [
    el('div', { class: 'thumb' }, [
      photoImg(urls.get(item.photo_path), item.title),
      item.verified ? null : el('span', { class: 'dot-warn', title: 'ждёт проверки' }),
    ]),
    el('div', { class: 'name', text: item.title }),
  ]);
}

function renderVerifyRow() {
  const row = $('#wd-verify-row');
  const pending = (state.items || []).filter((i) => !i.verified).length;
  clear(row);
  row.hidden = pending === 0 && !filters.unverifiedOnly;
  if (row.hidden) return;
  row.append(el('button', {
    class: 'verify-btn' + (filters.unverifiedOnly ? ' is-on' : ''),
    type: 'button',
    onclick: () => { filters.unverifiedOnly = !filters.unverifiedOnly; render(); },
  }, [
    filters.unverifiedOnly ? 'Показать все вещи' : `Необходима верификация · ${pending}`,
  ]));
}

/** Полоска подразделов. Ярлык раздела 1 уровня прилипает слева, пока едут его подразделы. */
function renderSectionBar(rows) {
  const counts = new Map();
  for (const i of rows) {
    const sub = subOfItem(i);
    counts.set(sub, (counts.get(sub) || 0) + 1);
  }

  const bar = clear($('#wd-section-bar'));
  bar.append(el('button', {
    class: 'chip chip-small' + (filters.sub ? '' : ' is-on'),
    type: 'button',
    onclick: () => { filters.sub = null; saveFilters(); render(); },
    text: 'Все',
  }));

  for (const section of SECTIONS) {
    const subs = section.subs.filter((s) => counts.get(s.id));
    if (!subs.length) continue;
    bar.append(el('span', { class: 'section-tag', dataset: { section: section.id }, text: section.label }));
    for (const sub of subs) {
      bar.append(el('button', {
        class: 'chip chip-small' + (filters.sub === sub.id ? ' is-on' : ''),
        type: 'button',
        dataset: { sub: sub.id, section: section.id },
        onclick: () => {
          filters.sub = filters.sub === sub.id ? null : sub.id;
          saveFilters();
          render();
        },
      }, [sub.label, el('span', { class: 'chip-count', text: String(counts.get(sub.id)) })]));
    }
  }
}

function renderActiveFilters() {
  const box = clear($('#wd-active-filters'));
  const bits = [];
  if (filters.status !== 'all') bits.push(labelOf(STATUSES, filters.status));
  if (filters.situation !== 'all') bits.push(labelOf(SITUATIONS, filters.situation));
  for (const s of filters.seasons) bits.push(labelOf(SEASONS, s));
  for (const c of filters.colors) bits.push(labelOf(COLORS, c));
  if (!bits.length) return;
  box.append(el('span', { class: 'muted small', text: bits.join(' · ') }));
  box.append(el('button', {
    class: 'link-btn', type: 'button', text: 'сбросить',
    onclick: () => {
      filters.status = 'all';
      filters.situation = 'all';
      filters.seasons.clear();
      filters.colors.clear();
      saveFilters();
      render();
    },
  }));
}

/** Пока листаешь сетку, в полоске подсвечивается раздел 1 уровня, который сейчас на экране. */
let scrollTimer = 0;
function onScroll() {
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = 0;
    const heads = document.querySelectorAll('.group-head');
    if (!heads.length) return;
    const limit = (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--head-h'), 10) || 150) + 12;
    let section = heads[0].dataset.section;
    for (const h of heads) {
      if (h.getBoundingClientRect().top <= limit) section = h.dataset.section;
    }
    highlightSection(section);
  }, 80);
}
window.addEventListener('scroll', onScroll, { passive: true });

let currentSection = null;
function highlightSection(sectionId) {
  if (sectionId === currentSection) return;
  for (const tag of document.querySelectorAll('.section-tag')) {
    const on = tag.dataset.section === sectionId;
    tag.classList.toggle('is-current', on);
    if (on) {
      // полоска сама подъезжает к разделу, который сейчас на экране
      const bar = $('#wd-section-bar');
      const left = Math.max(0, tag.offsetLeft - 8);
      if (Math.abs(bar.scrollLeft - left) > 24) bar.scrollTo({ left, behavior: 'smooth' });
    }
  }
  for (const chip of document.querySelectorAll('#wd-section-bar .chip[data-section]')) {
    chip.classList.toggle('is-dim', !!sectionId && chip.dataset.section !== sectionId && !chip.classList.contains('is-on'));
  }
  currentSection = sectionId;
}

// ------------------------------------------------------------------ дополнительные фильтры

function openFilters() {
  const body = clear($('#filters-body'));

  const single = (label, options, current, onPick) => {
    const row = el('div', { class: 'chips' });
    for (const o of options) {
      row.append(el('button', {
        class: 'chip chip-small' + (current() === o.id ? ' is-on' : ''),
        type: 'button', dataset: { id: o.id }, text: o.label,
        onclick: () => {
          onPick(o.id);
          for (const c of row.children) c.classList.toggle('is-on', c.dataset.id === o.id);
          render();
        },
      }));
    }
    return el('div', { class: 'group' }, [el('p', { class: 'group-label', text: label }), row]);
  };

  const multi = (label, options, set) => {
    const row = el('div', { class: 'chips' });
    for (const o of options) {
      const chip = el('button', {
        class: 'chip chip-small' + (set.has(o.id) ? ' is-on' : ''),
        type: 'button',
        onclick: () => {
          if (set.has(o.id)) set.delete(o.id); else set.add(o.id);
          chip.classList.toggle('is-on', set.has(o.id));
          saveFilters();
          render();
        },
      }, [o.hex ? el('span', { class: 'swatch', style: `background:${o.hex}` }) : null, o.label]);
      row.append(chip);
    }
    return el('div', { class: 'group' }, [el('p', { class: 'group-label', text: label }), row]);
  };

  body.append(
    single('Статус', [{ id: 'all', label: 'Любой' }, ...STATUSES], () => filters.status,
      (id) => { filters.status = id; saveFilters(); }),
    single('Ситуация', [{ id: 'all', label: 'Любая' }, ...SITUATIONS], () => filters.situation,
      (id) => { filters.situation = id; saveFilters(); }),
    multi('Сезон', SEASONS, filters.seasons),
    multi('Цвет', COLORS, filters.colors),
  );

  $('#filters-sheet').hidden = false;
  $('#filters-body').scrollTop = 0;
}
