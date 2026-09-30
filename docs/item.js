// Карточка вещи: правка, аналоги и просмотр фото с увеличением.
// Узор и логотип на экране не показываются — они остаются в базе для сборки луков.
import {
  sb, state, SITUATIONS, LAYERS, SLOT_BY_SECTION, SECTIONS_WITH_LAYER, COLORS, STATUSES, FORMALITY,
  el, $, clear, toast, photoImg, errText,
} from './lib.js';
import { SECTIONS, SEASONS, subOfItem, subLabel, sectionOf, CATEGORY_BY_SUB } from './sections.js';

let onSaved = null;   // колбэк для сетки: перерисоваться после сохранения
let urls = new Map(); // подписанные ссылки на фото, приходят из wardrobe.js

export function setItemContext({ photoUrlMap, afterSave }) {
  urls = photoUrlMap;
  onSaved = afterSave;
}

// ------------------------------------------------------------------ мелкие поля

function textField(label, value, { type = 'text', ...rest } = {}) {
  const input = el('input', { type, ...rest });
  input.value = value ?? '';
  return { node: el('label', { class: 'field' }, [el('span', { text: label }), input]), input };
}

function selectField(label, options, value) {
  const sel = el('select', {}, options.map((o) => {
    const opt = el('option', { value: String(o.id), text: o.label });
    if (String(o.id) === String(value)) opt.selected = true;
    return opt;
  }));
  return { node: el('label', { class: 'field' }, [el('span', { text: label }), sel]), input: sel };
}

function checkField(label, checked) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  return { node: el('label', { class: 'switch', style: 'margin:0' }, [input, el('span', { text: label })]), input };
}

function chipGroup(label, options, selected, { max = 99 } = {}) {
  const row = el('div', { class: 'chips' });
  for (const o of options) {
    const chip = el('button', {
      class: 'chip chip-small' + (selected.has(o.id) ? ' is-on' : ''),
      type: 'button',
      onclick: () => {
        if (selected.has(o.id)) selected.delete(o.id);
        else if (selected.size >= max) { toast(`Больше ${max} не выбрать`); return; }
        else selected.add(o.id);
        chip.classList.toggle('is-on', selected.has(o.id));
      },
    }, [o.hex ? el('span', { class: 'swatch', style: `background:${o.hex}` }) : null, o.label]);
    row.append(chip);
  }
  return el('div', { class: 'group' }, [el('p', { class: 'group-label', text: label }), row]);
}

// ------------------------------------------------------------------ карточка

export function openItem(item) {
  const sheet = $('#sheet');
  const body = clear($('#sheet-body'));
  $('#sheet-title').textContent = subLabel(subOfItem(item));

  const colors = new Set(item.colors || []);
  const sits = new Set(item.situations || []);
  const seasons = new Set(item.seasons || []);

  const analogsBtn = el('button', { class: 'btn btn-wide', type: 'button', onclick: () => openAnalogs(item) },
    ['Показать аналоги']);

  // фото: тап открывает на весь экран с увеличением
  const photo = el('button', {
    class: 'sheet-photo', type: 'button',
    onclick: () => openZoom(urls.get(item.photo_path), item.title),
  }, [photoImg(urls.get(item.photo_path), item.title)]);

  const title = textField('Название', item.title);
  const brand = textField('Бренд', item.brand);

  // раздел 1 уровня → подраздел: второй список перерисовывается при смене первого
  const currentSub = subOfItem(item);
  const section = selectField('Раздел', SECTIONS.map((s) => ({ id: s.id, label: s.label })),
    sectionOf(currentSub) || SECTIONS[0].id);
  const subWrap = el('div');
  let subSelect = null;

  function paintSubs(keep) {
    const sectionId = section.input.value;
    const subs = (SECTIONS.find((s) => s.id === sectionId) || SECTIONS[0]).subs;
    const value = subs.some((s) => s.id === keep) ? keep : subs[0].id;
    const built = selectField('Подраздел', subs, value);
    subSelect = built.input;
    clear(subWrap).append(built.node);
  }
  paintSubs(currentSub);

  // Слой — вопрос только для торса: что на тело, что поверх, что наружу.
  // У низа, обуви и аксессуаров слой берётся из раздела и не показывается.
  const layers = new Set((item.slots || []).filter((sl) => LAYERS.some((l) => l.id === sl)));
  const layerWrap = el('div');
  const paintLayer = () => {
    const show = SECTIONS_WITH_LAYER.has(section.input.value);
    layerWrap.hidden = !show;
    clear(layerWrap);
    if (show) layerWrap.append(chipGroup('Слой', LAYERS, layers));
  };
  paintLayer();

  section.input.addEventListener('change', () => { paintSubs(null); paintLayer(); });

  const material = textField('Материал', item.material);
  const fmin = selectField('Формальность от', FORMALITY, item.formality_min);
  const fmax = selectField('Формальность до', FORMALITY, item.formality_max);
  const tmin = textField('от, °C', item.temp_min, { type: 'number', inputmode: 'numeric' });
  const tmax = textField('до, °C', item.temp_max, { type: 'number', inputmode: 'numeric' });
  const status = selectField('Статус', STATUSES, item.status);
  const water = checkField('Непромокаемая', item.water_resistant);
  const wind = checkField('Ветрозащита', item.wind_resistant);
  const sleeveless = checkField('Без рукавов', item.sleeveless);
  const notes = el('textarea', { rows: 3 });
  notes.value = item.notes || '';

  body.append(
    photo,
    analogsBtn,
    item.verified ? el('p', { class: 'badge-line', text: '✓ проверено' }) : el('p', { class: 'badge-line badge-warn', text: 'Ждёт проверки — сохранение снимет отметку' }),
    title.node,
    brand.node,
    section.node,
    subWrap,
    layerWrap,
    chipGroup('Сезон', SEASONS, seasons),
    chipGroup('Ситуации', SITUATIONS, sits),
    chipGroup('Цвета (до трёх)', COLORS, colors, { max: 3 }),
    material.node,
    el('div', { class: 'row2' }, [fmin.node, fmax.node]),
    el('div', { class: 'group' }, [
      el('p', { class: 'group-label', text: 'Температура, когда сверху ничего нет' }),
      el('div', { class: 'row2' }, [tmin.node, tmax.node]),
    ]),
    status.node,
    water.node,
    wind.node,
    sleeveless.node,
    el('label', { class: 'field' }, [el('span', { text: 'Заметка' }), notes]),
    el('details', { class: 'advanced' }, [
      el('summary', { text: 'Откуда карточка' }),
      el('p', { class: 'muted small', text: `С доски: ${item.board_caption || '—'}` }),
      el('p', { class: 'muted small', text: `Файл: ${item.source_file}` }),
    ]),
  );

  const saveBtn = $('#sheet-save');
  saveBtn.onclick = async () => {
    const sub = subSelect.value;
    const sectionId = section.input.value;
    const slots = SECTIONS_WITH_LAYER.has(sectionId)
      ? [...layers]
      : [SLOT_BY_SECTION[sectionId]].filter(Boolean);
    const patch = {
      title: title.input.value.trim(),
      brand: brand.input.value.trim() || null,
      subcategory: sub,
      category: CATEGORY_BY_SUB[sub] || item.category,
      slots,
      colors: [...colors],
      seasons: [...seasons],
      situations: [...sits],
      material: material.input.value.trim() || null,
      formality_min: Number(fmin.input.value),
      formality_max: Number(fmax.input.value),
      temp_min: parseInt(tmin.input.value, 10),
      temp_max: parseInt(tmax.input.value, 10),
      water_resistant: water.input.checked,
      wind_resistant: wind.input.checked,
      sleeveless: sleeveless.input.checked,
      status: status.input.value,
      notes: notes.value.trim() || null,
      verified: true, // сохранил — значит проверил: вещь уходит из списка верификации
    };

    const problem = validate(patch);
    if (problem) { toast(problem); return; }

    saveBtn.disabled = true;
    const { data, error } = await sb.from('items').update(patch).eq('id', item.id).select().single();
    saveBtn.disabled = false;
    if (error) { toast(errText(error)); return; }

    Object.assign(item, data);
    sheet.hidden = true;
    onSaved?.();
    toast('Сохранено и отмечено как проверенное');
  };

  sheet.hidden = false;
  $('#sheet-body').scrollTop = 0;
}

function validate(p) {
  if (!p.title) return 'Название не может быть пустым';
  if (!p.slots.length) return 'Выбери хотя бы один слой: на тело, поверх или наружу';
  if (!p.colors.length) return 'Выбери хотя бы один цвет';
  if (!p.seasons.length) return 'Выбери хотя бы один сезон';
  if (p.formality_min > p.formality_max) return 'Формальность «от» больше, чем «до»';
  if (!Number.isFinite(p.temp_min) || !Number.isFinite(p.temp_max)) return 'Температура заполнена не до конца';
  if (p.temp_min > p.temp_max) return 'Температура «от» больше, чем «до»';
  return null;
}

// ------------------------------------------------------------------ аналоги

/** Аналог = тот же подраздел и хотя бы одна общая ситуация. */
export function analogsOf(item) {
  const sub = subOfItem(item);
  const sits = new Set(item.situations || []);
  return (state.items || []).filter((other) => {
    if (other.id === item.id) return false;
    if (subOfItem(other) !== sub) return false;
    if (!sits.size) return true;
    return (other.situations || []).some((s) => sits.has(s));
  });
}

function openAnalogs(item) {
  const rows = analogsOf(item);
  $('#analogs-title').textContent = subLabel(subOfItem(item));
  const body = clear($('#analogs-body'));

  const sits = (item.situations || []).map((s) => (SITUATIONS.find((x) => x.id === s) || {}).label).filter(Boolean);
  body.append(el('p', { class: 'muted small', text: sits.length ? `Та же ситуация: ${sits.join(', ')}` : 'Ситуации у этой вещи не заданы — показаны все из подраздела' }));

  if (!rows.length) {
    body.append(el('p', { class: 'empty', text: 'Похожих вещей нет' }));
  } else {
    body.append(el('div', { class: 'grid' }, rows.map((other) => el('button', {
      class: 'item-card' + (other.status === 'active' ? '' : ' is-off'),
      type: 'button',
      onclick: () => { $('#analogs').hidden = true; openItem(other); },
    }, [
      el('div', { class: 'thumb' }, [photoImg(urls.get(other.photo_path), other.title)]),
      el('div', { class: 'name', text: other.title }),
    ]))));
  }
  $('#analogs').hidden = false;
  $('#analogs-body').scrollTop = 0;
}

// ------------------------------------------------------------------ фото на весь экран

let zoomState = { scale: 1, x: 0, y: 0, startDist: 0, startScale: 1 };

export function initZoom() {
  const stage = $('#zoom-stage');
  const img = $('#zoom-img');
  $('#zoom-close').addEventListener('click', closeZoom);

  const apply = () => { img.style.transform = `translate(${zoomState.x}px, ${zoomState.y}px) scale(${zoomState.scale})`; };
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      zoomState.startDist = dist(e.touches);
      zoomState.startScale = zoomState.scale;
      e.preventDefault();
    } else if (e.touches.length === 1 && zoomState.scale > 1) {
      zoomState.panFrom = { x: e.touches[0].clientX - zoomState.x, y: e.touches[0].clientY - zoomState.y };
    }
  }, { passive: false });

  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && zoomState.startDist) {
      const k = dist(e.touches) / zoomState.startDist;
      zoomState.scale = Math.min(6, Math.max(1, zoomState.startScale * k));
      if (zoomState.scale === 1) { zoomState.x = 0; zoomState.y = 0; }
      apply();
      e.preventDefault();
    } else if (e.touches.length === 1 && zoomState.panFrom && zoomState.scale > 1) {
      zoomState.x = e.touches[0].clientX - zoomState.panFrom.x;
      zoomState.y = e.touches[0].clientY - zoomState.panFrom.y;
      apply();
      e.preventDefault();
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) { zoomState.startDist = 0; zoomState.panFrom = null; }
  });

  // двойной тап приближает, второй двойной — возвращает как было
  let lastTap = 0;
  stage.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastTap < 320) {
      zoomState.scale = zoomState.scale > 1 ? 1 : 2.5;
      zoomState.x = 0;
      zoomState.y = 0;
      apply();
    }
    lastTap = now;
  });

  // колесо с Ctrl — для проверки на компьютере
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomState.scale = Math.min(6, Math.max(1, zoomState.scale - e.deltaY * 0.01));
    if (zoomState.scale === 1) { zoomState.x = 0; zoomState.y = 0; }
    apply();
  }, { passive: false });
}

export function openZoom(url, alt) {
  if (!url) { toast('Фото ещё не загрузилось'); return; }
  zoomState = { scale: 1, x: 0, y: 0, startDist: 0, startScale: 1 };
  const img = $('#zoom-img');
  img.style.transform = '';
  img.src = url;
  img.alt = alt || '';
  $('#zoom').hidden = false;
}

export function closeZoom() { $('#zoom').hidden = true; }
