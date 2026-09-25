// Общая часть приложения: клиент Supabase, справочники, мелкие помощники.
// Схема данных и все решения — в DATA.md.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // вход по ссылке из письма: токены приходят в адресе
    flowType: 'implicit',
  },
});

// Состояние сессии: заполняется в app.js после входа.
export const state = {
  user: null,
  season: '2026-autumn',
  items: null,        // кэш карточек (гардероб и составы луков)
  ratings: new Map(), // look_id → оценка
};

// ------------------------------------------------------------------ справочники

export const SITUATIONS = [
  { id: 'gym', label: 'Спортзал' },
  { id: 'dog', label: 'Собака / район' },
  { id: 'office', label: 'Офис' },
  { id: 'weekend', label: 'Выходные' },
  { id: 'evening', label: 'Вечерний выход' },
];

export const SLOTS = [
  { id: 'base', label: 'База' },
  { id: 'layer2', label: '2-й слой' },
  { id: 'outer', label: 'Верх' },
  { id: 'bottom', label: 'Низ' },
  { id: 'shoes', label: 'Обувь' },
  { id: 'accessory', label: 'Аксессуар' },
];

export const CATEGORIES = [
  { id: 'tshirt', label: 'Футболка' },
  { id: 'longsleeve', label: 'Лонгслив' },
  { id: 'polo', label: 'Поло' },
  { id: 'shirt', label: 'Рубашка' },
  { id: 'sweater', label: 'Джемпер' },
  { id: 'sweatshirt', label: 'Свитшот' },
  { id: 'hoodie', label: 'Худи' },
  { id: 'vest', label: 'Безрукавка' },
  { id: 'blazer', label: 'Пиджак' },
  { id: 'jacket', label: 'Куртка' },
  { id: 'coat', label: 'Пальто' },
  { id: 'suit', label: 'Костюм' },
  { id: 'jeans', label: 'Джинсы' },
  { id: 'trousers', label: 'Брюки' },
  { id: 'shorts', label: 'Шорты' },
  { id: 'sweatpants', label: 'Спортивные штаны' },
  { id: 'shoes', label: 'Обувь' },
  { id: 'accessory', label: 'Аксессуар' },
];

export const COLORS = [
  { id: 'black', label: 'чёрный', hex: '#1b1b1b' },
  { id: 'white', label: 'белый', hex: '#fdfdfb' },
  { id: 'ecru', label: 'молочный', hex: '#efe6d6' },
  { id: 'grey', label: 'серый', hex: '#9a9a9a' },
  { id: 'navy', label: 'тёмно-синий', hex: '#22304c' },
  { id: 'indigo', label: 'индиго', hex: '#3b4b7c' },
  { id: 'blue', label: 'синий', hex: '#4176b8' },
  { id: 'teal', label: 'тёмная бирюза', hex: '#2b6b6b' },
  { id: 'olive', label: 'оливковый', hex: '#6b6b3a' },
  { id: 'khaki', label: 'хаки', hex: '#8a8158' },
  { id: 'green', label: 'зелёный', hex: '#3f7a4a' },
  { id: 'beige', label: 'бежевый', hex: '#d8c7a8' },
  { id: 'brown', label: 'коричневый', hex: '#6b4a34' },
  { id: 'burgundy', label: 'бордовый', hex: '#6d2436' },
  { id: 'red', label: 'красный', hex: '#b23a2f' },
  { id: 'yellow', label: 'жёлтый', hex: '#d8b13a' },
  { id: 'pink', label: 'розовый', hex: '#d79aa5' },
  { id: 'purple', label: 'фиолетовый', hex: '#6b4a7c' },
  { id: 'multi', label: 'разноцветная', hex: 'linear-gradient(135deg,#b23a2f,#d8b13a,#4176b8)' },
];

export const PATTERNS = [
  { id: 'solid', label: 'Однотонная' },
  { id: 'stripe', label: 'Полоска' },
  { id: 'check', label: 'Клетка' },
  { id: 'print', label: 'Принт' },
  { id: 'texture', label: 'Фактура' },
];

export const LOGOS = [
  { id: 'none', label: 'Нет' },
  { id: 'small', label: 'Мелкий' },
  { id: 'large', label: 'Крупный' },
];

export const STATUSES = [
  { id: 'active', label: 'Активна' },
  { id: 'archived', label: 'Архив' },
  { id: 'out', label: 'На аут' },
];

export const FORMALITY = [
  { id: 1, label: '1 · домашнее' },
  { id: 2, label: '2 · неформальное' },
  { id: 3, label: '3 · smart casual' },
  { id: 4, label: '4 · официальное' },
];

export const REASONS = [
  { id: 'hot', label: 'Жарко' },
  { id: 'cold', label: 'Холодно' },
  { id: 'wrong_situation', label: 'Не по ситуации' },
  { id: 'colors', label: 'Цвета не дружат' },
  { id: 'not_my_style', label: 'Не мой стиль' },
  { id: 'uncomfortable', label: 'Неудобно' },
];

export const labelOf = (dict, id) => (dict.find((x) => String(x.id) === String(id)) || {}).label || id || '';

// ------------------------------------------------------------------ DOM

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') node.style.cssText = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel) => document.querySelector(sel);
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

let toastTimer = null;
export function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

const SCREENS = ['auth', 'pick', 'look', 'wardrobe'];

/** Показать экран. Вкладки внизу прячутся на входе; «Лук» — это подэкран подбора. */
export function showScreen(name) {
  for (const s of SCREENS) $('#screen-' + s).hidden = s !== name;
  $('#tabbar').hidden = name === 'auth';
  for (const tab of document.querySelectorAll('.tab')) {
    const on = tab.dataset.tab === name || (name === 'look' && tab.dataset.tab === 'pick');
    tab.classList.toggle('is-on', on);
  }
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ фото

// Ссылки на фото подписываются на час; держим их в памяти и в sessionStorage,
// чтобы возвращение на вкладку не перезапрашивало сотню ссылок.
const SIGNED_TTL = 3600;
const signed = new Map();

try {
  const saved = JSON.parse(sessionStorage.getItem('photo-urls') || '{}');
  for (const [path, rec] of Object.entries(saved)) signed.set(path, rec);
} catch { /* приватный режим — просто работаем без кэша */ }

function persistSigned() {
  try {
    sessionStorage.setItem('photo-urls', JSON.stringify(Object.fromEntries(signed)));
  } catch { /* переполнение или запрет — не страшно */ }
}

/** Подписанные ссылки на фото. Принимает пути, возвращает Map path → url. */
export async function photoUrls(paths) {
  const now = Date.now();
  const want = [...new Set(paths.filter(Boolean))];
  const missing = want.filter((p) => !signed.has(p) || signed.get(p).exp < now + 60_000);
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const { data, error } = await sb.storage.from('wardrobe').createSignedUrls(chunk, SIGNED_TTL);
    if (error) { console.warn('createSignedUrls', error); continue; }
    for (const row of data || []) {
      if (row.signedUrl) signed.set(row.path, { url: row.signedUrl, exp: now + SIGNED_TTL * 1000 });
    }
  }
  if (missing.length) persistSigned();
  const out = new Map();
  for (const p of want) if (signed.has(p)) out.set(p, signed.get(p).url);
  return out;
}

export function photoImg(url, alt) {
  const img = el('img', { alt: alt || '', loading: 'lazy', decoding: 'async' });
  if (url) img.src = url;
  return img;
}

// ------------------------------------------------------------------ мелочи

export const tempLabel = (a, b) => `${a > 0 ? '+' : ''}${a}…${b > 0 ? '+' : ''}${b}°`;

/** Сегодняшняя дата по местному времени (а не по UTC — иначе вечером «надел» уедет на завтра). */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function errText(error) {
  const m = (error && (error.message || error.error_description)) || String(error || '');
  if (/rate limit|over_email_send/i.test(m)) return 'Письма кончились: встроенная почта Supabase шлёт 2 письма в час. Подожди начала следующего часа.';
  if (/Signups not allowed|otp_disabled/i.test(m)) return 'Этот адрес не приглашён в проект. Заведи его в панели Supabase (Authentication → Users → Add user).';
  if (/Token has expired|invalid/i.test(m)) return 'Код не подошёл или уже использован. Запроси новое письмо.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с базой. Проверь интернет и не заснул ли проект Supabase.';
  return m;
}

export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('wardrobe:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('wardrobe:' + key, JSON.stringify(value)); } catch { /* ok */ }
  },
};
