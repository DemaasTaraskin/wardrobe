// Экран «Гардероб»: сетка вещей, фильтры и правка карточки прямо с телефона.
import {
  sb, state, SITUATIONS, SLOTS, CATEGORIES, COLORS, PATTERNS, LOGOS, STATUSES, FORMALITY,
  el, $, clear, toast, photoUrls, photoImg, labelOf, errText, prefs,
} from './lib.js';

const filters = {
  status: prefs.get('wd-status', 'active'),
  situation: prefs.get('wd-situation', 'all'),
  query: '',
};

let urls = new Map();

export function initWardrobe() {
  $('#wd-search').addEventListener('input', (e) => {
    filters.query = e.target.value.trim().toLowerCase();
    renderGrid();
  });

  const box = clear($('#wd-filters'));
  box.append(chipRow(
    [{ id: 'active', label: 'Активные' }, { id: 'archived', label: 'Архив' }, { id: 'out', label: 'На аут' }, { id: 'all', label: 'Все' }],
    () => filters.status,
    (id) => { filters.status = id; prefs.set('wd-status', id); renderGrid(); },
  ));
  box.append(chipRow(
    [{ id: 'all', label: 'Любая ситуация' }, ...SITUATIONS],
    () => filters.situation,
    (id) => { filters.situation = id; prefs.set('wd-situation', id); renderGrid(); },
  ));
}

function chipRow(options, current, onPick) {
  const row = el('div', { class: 'chips' });
  for (const o of options) {
    row.append(el('button', {
      class: 'chip chip-small' + (current() === o.id ? ' is-on' : ''),
      type: 'button',
      text: o.label,
      dataset: { id: o.id },
      onclick: () => {
        onPick(o.id);
        for (const c of row.children) c.classList.toggle('is-on', c.dataset.id === o.id);
      },
    }));
  }
  return row;
}

export async function loadItems(force = false) {
  if (state.items && !force) return state.items;
  const { data, error } = await sb.from('items').select('*').order('category').order('title');
  if (error) throw error;
  state.items = data || [];
  urls = await photoUrls(state.items.map((i) => i.photo_path));
  return state.items;
}

export async function showWardrobe() {
  const grid = clear($('#wd-grid'));
  grid.append(el('div', { class: 'skeleton' }));
  try {
    await loadItems();
    renderGrid();
  } catch (e) {
    clear(grid).append(el('p', { class: 'msg err', text: errText(e) }));
  }
}

function visibleItems() {
  return (state.items || []).filter((i) => {
    if (filters.status !== 'all' && i.status !== filters.status) return false;
    if (filters.situation !== 'all' && !(i.situations || []).includes(filters.situation)) return false;
    if (filters.query) {
      const hay = `${i.title} ${i.brand || ''} ${labelOf(CATEGORIES, i.category)}`.toLowerCase();
      if (!hay.includes(filters.query)) return false;
    }
    return true;
  });
}

function renderGrid() {
  const rows = visibleItems();
  $('#wd-count').textContent = rows.length ? `${rows.length} из ${state.items.length} вещей` : '';
  const grid = clear($('#wd-grid'));
  if (!rows.length) {
    grid.append(el('p', { class: 'empty', text: 'Ничего не нашлось' }));
    return;
  }
  for (const item of rows) {
    grid.append(el('button', {
      class: 'item-card' + (item.status === 'active' ? '' : ' is-off'),
      type: 'button',
      onclick: () => openItem(item),
    }, [
      el('div', { class: 'thumb' }, [photoImg(urls.get(item.photo_path), item.title)]),
      el('div', { class: 'name', text: item.title }),
    ]));
  }
}

// ------------------------------------------------------------------ правка карточки

function multiChips(options, selected, onChange, { max = 99 } = {}) {
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
        onChange?.();
      },
    }, [
      o.hex ? el('span', { class: 'swatch', style: `background:${o.hex}` }) : null,
      o.label,
    ]);
    row.append(chip);
  }
  return row;
}

function selectField(label, options, value) {
  const sel = el('select', {}, options.map((o) => {
    const opt = el('option', { value: String(o.id), text: o.label });
    if (String(o.id) === String(value)) opt.selected = true;
    return opt;
  }));
  return { node: el('label', { class: 'field' }, [el('span', { text: label }), sel]), input: sel };
}

function textField(label, value, { type = 'text', ...rest } = {}) {
  const input = el('input', { type, ...rest });
  input.value = value ?? '';
  return { node: el('label', { class: 'field' }, [el('span', { text: label }), input]), input };
}

function checkField(label, checked) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  return { node: el('label', { class: 'switch', style: 'margin:0' }, [input, el('span', { text: label })]), input };
}

function openItem(item) {
  const sheet = $('#sheet');
  $('#sheet-title').textContent = labelOf(CATEGORIES, item.category);
  const body = clear($('#sheet-body'));

  const slots = new Set(item.slots || []);
  const colors = new Set(item.colors || []);
  const sits = new Set(item.situations || []);

  body.append(el('div', { class: 'sheet-photo' }, [photoImg(urls.get(item.photo_path), item.title)]));

  const title = textField('Название', item.title);
  const brand = textField('Бренд', item.brand);
  const category = selectField('Категория', CATEGORIES, item.category);
  const pattern = selectField('Узор', PATTERNS, item.pattern);
  const material = textField('Материал', item.material);
  const logo = selectField('Логотип', LOGOS, item.logo);
  const fmin = selectField('Формальность от', FORMALITY, item.formality_min);
  const fmax = selectField('Формальность до', FORMALITY, item.formality_max);
  const tmin = textField('Температура от, °C', item.temp_min, { type: 'number', inputmode: 'numeric' });
  const tmax = textField('Температура до, °C', item.temp_max, { type: 'number', inputmode: 'numeric' });
  const status = selectField('Статус', STATUSES, item.status);
  const water = checkField('Непромокаемая', item.water_resistant);
  const wind = checkField('Ветрозащита', item.wind_resistant);
  const sleeveless = checkField('Без рукавов', item.sleeveless);
  const notes = el('textarea', { rows: 3 });
  notes.value = item.notes || '';

  body.append(
    title.node,
    brand.node,
    category.node,
    el('div', {}, [el('p', { class: 'field', style: 'margin:0 0 6px', text: 'Слоты' }), multiChips(SLOTS, slots, null, { max: 3 })]),
    el('div', {}, [el('p', { class: 'field', style: 'margin:0 0 6px', text: 'Ситуации' }), multiChips(SITUATIONS, sits)]),
    el('div', {}, [el('p', { class: 'field', style: 'margin:0 0 6px', text: 'Цвета (до трёх)' }), multiChips(COLORS, colors, null, { max: 3 })]),
    pattern.node,
    material.node,
    logo.node,
    el('div', { class: 'row2' }, [fmin.node, fmax.node]),
    el('div', { class: 'row2' }, [tmin.node, tmax.node]),
    status.node,
    water.node,
    wind.node,
    sleeveless.node,
    el('label', { class: 'field' }, [el('span', { text: 'Заметка' }), notes]),
    el('p', { class: 'muted small', text: `С доски: ${item.board_caption || '—'}` }),
    el('p', { class: 'muted small', text: `Файл: ${item.source_file}` }),
  );

  const saveBtn = $('#sheet-save');
  saveBtn.onclick = async () => {
    const patch = {
      title: title.input.value.trim(),
      brand: brand.input.value.trim() || null,
      category: category.input.value,
      slots: [...slots],
      colors: [...colors],
      pattern: pattern.input.value,
      material: material.input.value.trim() || null,
      logo: logo.input.value,
      formality_min: Number(fmin.input.value),
      formality_max: Number(fmax.input.value),
      temp_min: parseInt(tmin.input.value, 10),
      temp_max: parseInt(tmax.input.value, 10),
      situations: [...sits],
      water_resistant: water.input.checked,
      wind_resistant: wind.input.checked,
      sleeveless: sleeveless.input.checked,
      status: status.input.value,
      notes: notes.value.trim() || null,
    };

    const problem = validate(patch);
    if (problem) { toast(problem); return; }

    saveBtn.disabled = true;
    const { data, error } = await sb.from('items').update(patch).eq('id', item.id).select().single();
    saveBtn.disabled = false;
    if (error) { toast(errText(error)); return; }

    Object.assign(item, data);
    sheet.hidden = true;
    renderGrid();
    toast('Сохранено');
  };

  sheet.hidden = false;
  $('#sheet-body').scrollTop = 0;
}

function validate(p) {
  if (!p.title) return 'Название не может быть пустым';
  if (!p.slots.length) return 'Выбери хотя бы один слот';
  if (!p.colors.length) return 'Выбери хотя бы один цвет';
  if (p.formality_min > p.formality_max) return 'Формальность «от» больше, чем «до»';
  if (!Number.isFinite(p.temp_min) || !Number.isFinite(p.temp_max)) return 'Температура заполнена не до конца';
  if (p.temp_min > p.temp_max) return 'Температура «от» больше, чем «до»';
  return null;
}
