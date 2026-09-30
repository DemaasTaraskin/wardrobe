// Точка входа: вход по паролю, вкладки, запуск экранов.
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

  $('#btn-logout').addEventListener('click', async () => {
    $('#menu').hidden = true;
    await sb.auth.signOut();
    location.reload();
  });
}

function closeTop() {
  if (!$('#zoom').hidden) { closeZoom(); return; }
  for (const id of ['#analogs', '#filters-sheet', '#password-sheet', '#menu', '#sheet']) {
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

  initPick();
  initWardrobe();
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
