// Точка входа: вход по почте, вкладки, запуск экранов.
import { sb, state, $, toast, showScreen, errText, prefs } from './lib.js';
import { initPick, runPick } from './pick.js';
import { initWardrobe, showWardrobe, loadItems } from './wardrobe.js';

let booted = false;

// ------------------------------------------------------------------ вход

function authMsg(text, isError = false) {
  const box = $('#auth-msg');
  box.hidden = !text;
  box.textContent = text || '';
  box.classList.toggle('err', !!isError);
}

function initAuth() {
  const emailForm = $('#auth-email-form');
  const codeForm = $('#auth-code-form');
  const emailInput = $('#auth-email');
  emailInput.value = prefs.get('email', '');

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;
    const btn = emailForm.querySelector('button');
    btn.disabled = true;
    authMsg('Отправляю письмо…');
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false, // регистрация закрыта: только приглашённые адреса
        emailRedirectTo: location.origin + location.pathname,
      },
    });
    btn.disabled = false;
    if (error) { authMsg(errText(error), true); return; }
    prefs.set('email', email);
    authMsg('Письмо ушло. Введи код из него — или просто нажми в письме ссылку.');
    emailForm.hidden = true;
    codeForm.hidden = false;
    $('#auth-code').focus();
  });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('#auth-code').value.replace(/\D/g, '');
    if (token.length < 6) { authMsg('Код — шесть цифр', true); return; }
    const btn = codeForm.querySelector('button');
    btn.disabled = true;
    authMsg('Проверяю код…');
    const { error } = await sb.auth.verifyOtp({ email: emailInput.value.trim(), token, type: 'email' });
    btn.disabled = false;
    if (error) { authMsg(errText(error), true); return; }
    authMsg('');
  });

  $('#auth-back').addEventListener('click', () => {
    codeForm.hidden = true;
    emailForm.hidden = false;
    authMsg('');
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
    node.addEventListener('click', () => { $('#sheet').hidden = true; $('#menu').hidden = true; });
  }
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

async function boot() {
  initAuth();
  initChrome();

  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    cleanUrl();
    await start(session.user);
  } else {
    showScreen('auth');
  }

  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_IN' && s?.user) {
      cleanUrl();
      start(s.user);
    }
    if (event === 'SIGNED_OUT') showScreen('auth');
  });

  // ошибка из ссылки письма приходит в адресе
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('error_description')) {
    authMsg(decodeURIComponent(hash.get('error_description')).replace(/\+/g, ' '), true);
    cleanUrl();
  }
}

function cleanUrl() {
  if (location.hash || location.search) history.replaceState(null, '', location.pathname);
}

boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* не критично */ }));
}
