// Экран «Гардероб»: три полосы (раздел 1 уровня, подраздел, ситуация),
// сетка по подразделам и список «Необходима верификация».
import {
  sb, state, SITUATIONS, COLORS, STATUSES,
  el, $, clear, photoUrls, photoImg, labelOf, errText, prefs,
} from './lib.js';
import { SECTIONS, SEASONS, subOfItem, subLabel, sectionOf } from './sections.js';
import { openItem, setItemContext, initZoom } from './item.js';

const filters = {
  sections: new Set(prefs.get('wd-sections', [])),
  subs: new Set(prefs.get('wd-subs', [])),
  situation: prefs.get('wd-situation', 'all'),
  status: prefs.get('wd-status', 'all'),
  seasons: new Set(prefs.get('wd-seasons', [])),
  colors: new Set(prefs.get('wd-colors', [])),
  unverifiedOnly: false,
  query: '',
};

let urls = new Map();
let collapsed = new Set(prefs.get('wd-collapsed', []));

function saveFilters() {
  prefs.set('wd-sections', [...filters.sections]);
  prefs.set('wd-subs', [...filters.subs]);
  prefs.set('wd-situation', filters.situation);
  prefs.set('wd-status', filters.status);
  prefs.set('wd-seasons', [...filters.seasons]);
  prefs.set('wd-colors', [...filters.colors]);
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
    saveFilters();
    openFilters();
    render();
  });
  $('#btn-verify').addEventListener('click', () => {
    filters.unverifiedOnly = !filters.unverifiedOnly;
    render();
  });
  $('#btn-reset-filters').addEventListener('click', resetAll);
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
  } catch (e) {
    // не грузятся данные — показываем причину и даём повторить, а не пустой экран
    clear(box).append(
      el('p', { class: 'msg err', text: errText(e) }),
      el('button', { class: 'btn btn-wide', type: 'button', onclick: () => showWardrobe() }, ['Повторить']),
    );
    return;
  }
  try {
    render();
  } catch (e) {
    clear(box).append(el('p', { class: 'msg err', text: 'Сетка не нарисовалась: ' + errText(e) }));
  }
}

// ------------------------------------------------------------------ отбор

/** Всё, кроме раздела и подраздела: по этому набору считаются цифры в полосах. */
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

const baseItems = () => (state.items || []).filter(matchesCommon);

function applySections(rows) {
  return rows.filter((i) => {
    const sub = subOfItem(i);
    if (filters.subs.size) return filters.subs.has(sub);
    if (filters.sections.size) return filters.sections.has(sectionOf(sub));
    return true;
  });
}

// ------------------------------------------------------------------ отрисовка

function render() {
  const rows = baseItems();
  renderVerifyRow();
  renderBars(rows);
  renderActiveFilters();

  const shown = applySections(rows);
  $('#wd-count').textContent = `${shown.length} из ${(state.items || []).length} вещей`;

  const box = clear($('#wd-groups'));
  if (!shown.length) {
    box.append(el('p', { class: 'empty', text: 'Ничего не нашлось' }));
  } else {
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
  const btn = $('#btn-verify');
  const pending = (state.items || []).filter((i) => !i.verified).length;
  $('#verify-count').textContent = String(pending);
  btn.hidden = pending === 0 && !filters.unverifiedOnly;
  btn.classList.toggle('is-on', filters.unverifiedOnly);
  btn.title = filters.unverifiedOnly ? 'Показать все вещи' : `Ждут проверки: ${pending}`;
}

// ------------------------------------------------------------------ три полосы

function chip(label, isOn, onclick, { count, section, sub } = {}) {
  const dataset = {};
  if (section) dataset.section = section;
  if (sub) dataset.sub = sub;
  return el('button', {
    class: 'chip chip-small' + (isOn ? ' is-on' : ''),
    type: 'button', dataset, onclick,
  }, [label, count === undefined ? null : el('span', { class: 'chip-count', text: String(count) })]);
}

function renderBars(rows) {
  const bySub = new Map();
  const bySection = new Map();
  for (const i of rows) {
    const sub = subOfItem(i);
    const section = sectionOf(sub);
    bySub.set(sub, (bySub.get(sub) || 0) + 1);
    bySection.set(section, (bySection.get(section) || 0) + 1);
  }

  // 1. раздел 1 уровня: куртки · верх · низ · обувь · аксессуары, можно выбрать несколько
  const bar1 = clear($('#wd-level1'));
  bar1.append(chip('Все', !filters.sections.size && !filters.subs.size, () => {
    filters.sections.clear();
    filters.subs.clear();
    saveFilters();
    render();
  }));
  for (const section of SECTIONS) {
    const n = bySection.get(section.id) || 0;
    if (!n) continue;
    bar1.append(chip(section.label, filters.sections.has(section.id), () => {
      if (filters.sections.has(section.id)) filters.sections.delete(section.id);
      else filters.sections.add(section.id);
      // подразделы, выпавшие из выбранных разделов, снимаются сами
      if (filters.sections.size) {
        for (const sub of [...filters.subs]) {
          if (!filters.sections.has(sectionOf(sub))) filters.subs.delete(sub);
        }
      }
      saveFilters();
      render();
    }, { count: n, section: section.id }));
  }

  // 2. подразделы: без выбранного раздела — все подряд, с выбранным — только его
  const bar2 = clear($('#wd-level2'));
  const shownSections = filters.sections.size
    ? SECTIONS.filter((x) => filters.sections.has(x.id))
    : SECTIONS;
  for (const section of shownSections) {
    for (const sub of section.subs) {
      const n = bySub.get(sub.id) || 0;
      if (!n) continue;
      bar2.append(chip(sub.label, filters.subs.has(sub.id), () => {
        if (filters.subs.has(sub.id)) filters.subs.delete(sub.id);
        else filters.subs.add(sub.id);
        saveFilters();
        render();
      }, { count: n, section: section.id, sub: sub.id }));
    }
  }

  // 3. ситуация: на экране остаётся только то, что ей подходит
  const bar3 = clear($('#wd-situations'));
  for (const s of [{ id: 'all', label: 'Любая ситуация' }, ...SITUATIONS]) {
    bar3.append(chip(s.label, filters.situation === s.id, () => {
      filters.situation = s.id;
      saveFilters();
      render();
    }));
  }
}

/** Подводит полосы к разделу: в первой — сам раздел, во второй — его первый подраздел. */
function scrollBarsTo(sectionId) {
  if (!sectionId) return;
  for (const barId of ['#wd-level1', '#wd-level2']) {
    const bar = $(barId);
    const chipEl = bar.querySelector(`.chip[data-section="${sectionId}"]`);
    if (!chipEl) continue;
    const left = Math.max(0, chipEl.offsetLeft - 8);
    if (Math.abs(bar.scrollLeft - left) > 12) bar.scrollTo({ left, behavior: 'smooth' });
  }
}

function resetAll() {
  filters.sections.clear();
  filters.subs.clear();
  filters.seasons.clear();
  filters.colors.clear();
  filters.situation = 'all';
  filters.status = 'all';
  filters.unverifiedOnly = false;
  filters.query = '';
  $('#wd-search').value = '';
  saveFilters();
  render();
}

function renderActiveFilters() {
  const box = clear($('#wd-active-filters'));
  const bits = [];
  if (filters.status !== 'all') bits.push(labelOf(STATUSES, filters.status));
  for (const s of filters.seasons) bits.push(labelOf(SEASONS, s));
  for (const c of filters.colors) bits.push(labelOf(COLORS, c));
  if (!bits.length) return;
  box.append(el('span', { class: 'muted small', text: bits.join(' · ') }));
  box.append(el('button', {
    class: 'link-btn', type: 'button', text: 'сбросить',
    onclick: () => {
      filters.status = 'all';
      filters.seasons.clear();
      filters.colors.clear();
      saveFilters();
      render();
    },
  }));
}

/** Пока листаешь сетку без выбранного раздела, полосы едут за тем, что на экране. */
let scrollTimer = 0;
function onScroll() {
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = 0;
    if (filters.sections.size || filters.subs.size) return;
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
  currentSection = sectionId;
  for (const chipEl of document.querySelectorAll('#wd-level1 .chip[data-section]')) {
    chipEl.classList.toggle('is-current', chipEl.dataset.section === sectionId);
  }
  scrollBarsTo(sectionId);
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
      const chipEl = el('button', {
        class: 'chip chip-small' + (set.has(o.id) ? ' is-on' : ''),
        type: 'button',
        onclick: () => {
          if (set.has(o.id)) set.delete(o.id); else set.add(o.id);
          chipEl.classList.toggle('is-on', set.has(o.id));
          saveFilters();
          render();
        },
      }, [o.hex ? el('span', { class: 'swatch', style: `background:${o.hex}` }) : null, o.label]);
      row.append(chipEl);
    }
    return el('div', { class: 'group' }, [el('p', { class: 'group-label', text: label }), row]);
  };

  body.append(
    single('Статус', [{ id: 'all', label: 'Любой' }, ...STATUSES], () => filters.status,
      (id) => { filters.status = id; saveFilters(); }),
    multi('Сезон', SEASONS, filters.seasons),
    multi('Цвет', COLORS, filters.colors),
  );

  $('#filters-sheet').hidden = false;
  $('#filters-body').scrollTop = 0;
}
