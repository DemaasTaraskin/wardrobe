// Точка входа: вход по паролю, вкладки, запуск экранов.
// Версия сборки: её же ждёт index.html. Меняются оба места вместе —
// по несовпадению приложение понимает, что браузер подсунул старый файл.
window.__wardrobeBuild = '2026-10-01-2';
import { sb, state, $, toast, showScreen, errText, prefs } from './lib.js';
import { initPick, runPick } from './pick.js';
import { initWardrobe, showWardrobe, loadItems } from './wardrobe.js';
import { closeZoom } from './item.js';

// Адрес читаем сразу: библиотека Supabase вычищает из него токены и ошибки
// в ближайшей же микрозадаче, и сообщение «ссылка протухла» иначе теряется.
const INITIAL_HASH = location.hash.slice(1);
const INITIAL_QUERY = location.search.slice(1);

let booted = false;

// ------------------------------------------------------------------ вход

function authMsg(text, isError = false) {
  const box = $('#auth-msg');
  box.hidden = !text;
  box.textContent = text || '';
  box.classList.toggle('err', !!isError);
}

function initAuth() {
  const form = $('#auth-form');
  const linkBox = $('#auth-link-box');
  const email = $('#auth-email');
  const password = $('#auth-password');
  email.value = prefs.get('email', '');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    authMsg('Проверяю…');
    const { error } = await sb.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value,
    });
    btn.disabled = false;
    if (error) {
      const wrong = /Invalid login credentials/i.test(error.message || '');
      authMsg(wrong
        ? 'Почта или пароль не подошли. Если пароль ещё не задан — войди по ссылке на почту и задай его в меню «⋯».'
        : errText(error), true);
      return;
    }
    prefs.set('email', email.value.trim());
    authMsg('');
  });

  $('#auth-by-link').addEventListener('click', () => {
    form.hidden = true;
    linkBox.hidden = false;
    authMsg('');
  });

  $('#auth-back-to-password').addEventListener('click', () => {
    linkBox.hidden = true;
    form.hidden = false;
    authMsg('');
  });

  $('#auth-send-link').addEventListener('click', async (e) => {
    const addr = email.value.trim();
    if (!addr) { authMsg('Сначала впиши почту', true); form.hidden = false; linkBox.hidden = true; return; }
    e.target.disabled = true;
    authMsg('Отправляю письмо…');
    const { error } = await sb.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    e.target.disabled = false;
    if (error) { authMsg(errText(error), true); return; }
    prefs.set('email', addr);
    authMsg('Письмо ушло. Открой его на этом же телефоне и нажми ссылку «Sign in».');
  });
}

/** Пароль задаётся из приложения: аккаунт заведён приглашением и пароля не имеет. */
function initPasswordSheet() {
  const sheet = $('#password-sheet');
  const first = $('#password-new');
  const again = $('#password-again');
  const msg = $('#password-msg');

  $('#btn-set-password').addEventListener('click', () => {
    $('#menu').hidden = true;
    first.value = '';
    again.value = '';
    msg.hidden = true;
    sheet.hidden = false;
    first.focus();
  });

  $('#password-save').addEventListener('click', async () => {
    const value = first.value;
    const show = (text, isError = true) => {
      msg.hidden = false;
      msg.textContent = text;
      msg.classList.toggle('err', isError);
    };
    if (value.length < 8) { show('Пароль должен быть от 8 знаков'); return; }
    if (value !== again.value) { show('Пароли не совпали'); return; }

    $('#password-save').disabled = true;
    const { error } = await sb.auth.updateUser({ password: value });
    $('#password-save').disabled = false;
    if (error) { show(errText(error)); return; }
    sheet.hidden = true;
    toast('Пароль сохранён — дальше входи по нему');
  });
}

// ------------------------------------------------------------------ вкладки и меню

function initChrome() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => openTab(tab.dataset.tab));
  }
  for (const btn of ['#btn-menu', '#btn-menu-2']) {
    $(btn).addEventListener('click', () => {
      $('#menu-user').textContent = state.user?.email || '';
      $('#menu').hidden = false;
    });
  }
  for (const node of document.querySelectorAll('[data-close]')) {
    node.addEventListener('click', () => {
      const sheet = node.closest('.sheet');
      if (sheet) sheet.hidden = true;
    });
  }
  // Esc закрывает верхнюю шторку
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTop(); });

  // пока открыта шторка, фон под ней не должен прокручиваться
  const sheets = [...document.querySelectorAll('.sheet'), $('#zoom')];
  const syncScrollLock = () => {
    document.body.classList.toggle('sheet-open', sheets.some((s) => !s.hidden));
  };
  const watcher = new MutationObserver(syncScrollLock);
  for (const s of sheets) watcher.observe(s, { attributes: true, attributeFilter: ['hidden'] });

  $('#btn-refresh').addEventListener('click', async () => {
    $('#menu').hidden = true;
    state.items = null;
    state.ratings.clear();
    try {
      await loadItems(true);
      if ($('#screen-wardrobe').hidden) await runPick();
      else await showWardrobe();
      toast('Обновил');
    } catch (e) {
      toast(errText(e));
    }
  });

  $('#btn-diagnostics').addEventListener('click', showDiagnostics);
  $('#diag-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#diag-text').textContent);
      toast('Скопировано — пришли это в чат');
    } catch {
      toast('Скопировать не вышло, сделай скриншот');
    }
  });
  $('#diag-reset').addEventListener('click', async () => {
    try {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
      sessionStorage.removeItem('wardrobe-refreshed');
    } catch { /* приватный режим */ }
    location.reload();
  });

  $('#btn-logout').addEventListener('click', async () => {
    $('#menu').hidden = true;
    // scope: 'local' — гасим только этот браузер. По умолчанию Supabase
    // отзывает все сессии пользователя, включая рабочую сессию скила.
    await sb.auth.signOut({ scope: 'local' });
    location.reload();
  });
}

/** Что показать в чат, когда на телефоне что-то не грузится. */
async function showDiagnostics() {
  $('#menu').hidden = true;
  // шторку открываем сразу и дописываем строки по мере готовности: если один
  // из запросов повиснет, уже собранное всё равно будет видно
  $('#diag-text').textContent = 'Собираю…';
  $('#diag-sheet').hidden = false;
  const lines = [];
  const say = (k, v) => {
    lines.push(`${k}: ${v}`);
    $('#diag-text').textContent = lines.join('\n');
  };
  say('версия сборки', window.__wardrobeBuild || 'неизвестна');
  say('адрес', location.href);
  say('браузер', navigator.userAgent);
  say('сеть', navigator.onLine ? 'есть' : 'нет');
  try {
    const { data: { session } } = await sb.auth.getSession();
    say('сессия', session ? `есть, истекает ${new Date(session.expires_at * 1000).toLocaleString('ru-RU')}` : 'нет');
    say('почта', session?.user?.email || '—');
  } catch (e) {
    say('сессия', 'ошибка: ' + (e.message || e));
  }
  say('вещей загружено', state.items ? state.items.length : 'не загружались');
  try {
    const t0 = Date.now();
    const { data, error, status } = await sb.from('items').select('id').limit(1);
    say('запрос к базе', error ? `ошибка ${status}: ${error.message}` : `ответ за ${Date.now() - t0} мс, строк ${data.length}`);
  } catch (e) {
    say('запрос к базе', 'упал: ' + (e.message || e));
  }
  if (state.items?.length) {
    try {
      const { data, error } = await sb.storage.from('wardrobe')
        .createSignedUrls([state.items[0].photo_path], 60);
      say('ссылки на фото', error ? `ошибка: ${error.message}` : `получено ${data?.length ?? 0}`);
    } catch (e) {
      say('ссылки на фото', 'упали: ' + (e.message || e));
    }
  }
  try {
    say('service worker', (await navigator.serviceWorker.getRegistrations()).length ? 'установлен' : 'нет');
    say('кэши', (await caches.keys()).join(', ') || 'пусто');
  } catch { say('service worker', 'недоступен'); }
  if (state.lastError) say('последняя ошибка', `${state.lastError.when} — ${state.lastError.raw}`);
}

function closeTop() {
  if (!$('#zoom').hidden) { closeZoom(); return; }
  for (const id of ['#analogs', '#filters-sheet', '#password-sheet', '#diag-sheet', '#menu', '#sheet']) {
    if (!$(id).hidden) { $(id).hidden = true; return; }
  }
}

function openTab(name) {
  showScreen(name);
  if (name === 'wardrobe') showWardrobe();
}

// ------------------------------------------------------------------ запуск

async function start(user) {
  state.user = user;
  if (booted) return;
  booted = true;

  const { data } = await sb.from('profiles').select('current_season').eq('id', user.id).maybeSingle();
  if (data?.current_season) state.season = data.current_season;

  // Экран показываем в любом случае: если что-то из инициализации упадёт,
  // пустого белого листа быть не должно — будет видно ошибку.
  try {
    initPick();
    initWardrobe();
  } catch (e) {
    toast(errText(e));
  }
  showScreen('pick');
  runPick();
  loadItems().catch(() => { /* сетка подгрузится при открытии вкладки */ });
}

function urlError() {
  for (const raw of [INITIAL_HASH, INITIAL_QUERY]) {
    if (!raw) continue;
    const p = new URLSearchParams(raw);
    const text = p.get('error_description') || p.get('error');
    if (text) return decodeURIComponent(text).replace(/\+/g, ' ');
  }
  return null;
}

async function boot() {
  initAuth();
  initChrome();
  initPasswordSheet();

  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    cleanUrl();
    await start(session.user);
  } else {
    showScreen('auth');
    const problem = urlError();
    if (problem) {
      authMsg(`Ссылка из письма не сработала: ${problem}. Ссылки одноразовые и живут час — запроси новое письмо или войди по паролю.`, true);
      cleanUrl();
    }
  }

  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_IN' && s?.user) {
      cleanUrl();
      start(s.user);
    }
    if (event === 'SIGNED_OUT') showScreen('auth');
  });
}

function cleanUrl() {
  if (location.hash || location.search) history.replaceState(null, '', location.pathname);
}

boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* не критично */ }));
}
