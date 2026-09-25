"""Вход в Supabase по коду на почту. Паролей нет.

  python login.py request <почта>   — просит прислать код (письмо приходит тебе)
  python login.py verify  <код>     — сохраняет сессию в .supabase-session.json
  python login.py accept  <ссылка>  — если в письме не код, а ссылка (приглашение,
                                      «Confirm email address»): скопируй адрес ссылки
                                      и передай сюда
  python login.py status            — кто сейчас в сессии и до какого времени она живёт
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import sb

PENDING = sb.ROOT / ".supabase-login-pending.json"


def request(email: str) -> None:
    c = sb.Client(anonymous=True)
    status, raw, _ = sb._request(
        "POST", f"{c.url}/auth/v1/otp",
        headers={"apikey": c.key},
        body={"email": email, "create_user": False})
    text = raw.decode("utf-8", "replace")
    if status >= 400:
        if "Signups not allowed" in text or "signup_disabled" in text:
            raise SystemExit(
                f"Пользователя {email} в проекте нет (и самостоятельная регистрация выключена — так и задумано).\n"
                "Заведи его: панель Supabase → Authentication → Users → Add user → Send invitation.")
        raise SystemExit(f"Не удалось запросить код: HTTP {status} {text[:300]}")
    PENDING.write_text(json.dumps({"email": email}), encoding="utf-8")
    print(f"Код отправлен на {email}. Письмо от Supabase, тема Magic Link / Confirm your signup —\n"
          "в нём шестизначный код. Пришли его в чат, и я выполню verify.")


def verify(code: str) -> None:
    if not PENDING.exists():
        raise SystemExit("Сначала запроси код: login.py request <почта>")
    email = json.loads(PENDING.read_text(encoding="utf-8"))["email"]
    c = sb.Client(anonymous=True)
    status, raw, _ = sb._request(
        "POST", f"{c.url}/auth/v1/verify",
        headers={"apikey": c.key},
        body={"type": "email", "email": email, "token": code.strip()})
    text = raw.decode("utf-8", "replace")
    if status >= 400:
        raise SystemExit(f"Код не подошёл: HTTP {status} {text[:300]}\n"
                         "Коды живут около часа и одноразовые — запроси новый.")
    session = json.loads(text)
    c.save_session(session)
    PENDING.unlink(missing_ok=True)
    print(f"Вход выполнен: {session['user']['email']}")
    print(f"Сессия сохранена в {sb.SESSION_FILE.name} (в .gitignore), дальше обновляется сама.")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **kw):  # noqa: D401 — нам нужен сам ответ 302
        return None


def accept(link: str) -> None:
    """Меняет ссылку из письма на сессию.

    Письма-приглашения и «Confirm email address» вместо шестизначного кода содержат
    ссылку вида .../auth/v1/verify?token=…&type=invite&redirect_to=… . Ссылка
    одноразовая: открывать её в браузере не нужно, достаточно передать сюда адрес.
    """
    c = sb.Client(anonymous=True)
    parsed = urllib.parse.urlparse(link)
    q = urllib.parse.parse_qs(parsed.query)
    frag0 = urllib.parse.parse_qs(parsed.fragment)

    # случай попроще: по ссылке уже кликнули, и токены лежат в адресной строке
    # (http://localhost:3000/#access_token=…&refresh_token=…) — страница не открылась,
    # но вход состоялся, адрес и есть сессия
    if "access_token" in frag0:
        _finish({"access_token": frag0["access_token"][0],
                 "refresh_token": frag0["refresh_token"][0],
                 "expires_in": int(frag0.get("expires_in", ["3600"])[0])}, c)
        return
    if "error_description" in frag0:
        raise SystemExit("Ссылка не сработала: "
                         + urllib.parse.unquote_plus(frag0["error_description"][0]))

    token = (q.get("token") or q.get("token_hash") or [""])[0]
    kind = (q.get("type") or ["invite"])[0]
    if not token:
        raise SystemExit("В ссылке нет ни token, ни access_token — пришли адрес целиком, "
                         "от https:// (или http://localhost) и до конца.")

    # сначала честный способ: POST /verify с хэшем токена
    status_code, raw, _ = sb._request(
        "POST", f"{c.url}/auth/v1/verify",
        headers={"apikey": c.key}, body={"type": kind, "token_hash": token})
    session = None
    if status_code < 400:
        session = json.loads(raw)
    else:
        # запасной: пройти по ссылке и забрать токены из адреса, куда она ведёт
        opener = urllib.request.build_opener(_NoRedirect)
        req = urllib.request.Request(link, headers={"apikey": c.key})
        try:
            resp = opener.open(req, timeout=30)
            location = resp.headers.get("Location", "")
        except urllib.error.HTTPError as e:
            location = e.headers.get("Location", "") if e.code in (301, 302, 303, 307, 308) else ""
        frag = urllib.parse.parse_qs(urllib.parse.urlparse(location).fragment)
        if "access_token" not in frag:
            err = frag.get("error_description") or frag.get("error") or []
            raise SystemExit(
                "Ссылка не сработала: "
                + (urllib.parse.unquote_plus(err[0]) if err else "нет токена в ответе")
                + f"\n(ответ /verify: HTTP {status_code} {raw.decode('utf-8', 'replace')[:200]})"
                + "\nЧаще всего это значит, что по ссылке уже переходили: она одноразовая."
                  " Надёжнее вход по коду — добавь {{ .Token }} в шаблон письма Magic Link"
                  " (Authentication → Emails) и используй login.py request/verify.")
        session = {
            "access_token": frag["access_token"][0],
            "refresh_token": frag["refresh_token"][0],
            "expires_in": int(frag.get("expires_in", ["3600"])[0]),
        }

    _finish(session, c)


def _finish(session: dict, c: "sb.Client") -> None:
    if "user" not in session:
        st, raw_user, _ = sb._request(
            "GET", f"{c.url}/auth/v1/user",
            headers={"apikey": c.key, "Authorization": "Bearer " + session["access_token"]})
        if st >= 400:
            raise SystemExit(f"Не удалось прочитать пользователя: {raw_user.decode('utf-8', 'replace')[:200]}")
        session["user"] = json.loads(raw_user)

    c.save_session(session)
    PENDING.unlink(missing_ok=True)
    print(f"Вход выполнен: {session['user']['email']}")
    print(f"Сессия сохранена в {sb.SESSION_FILE.name} (в .gitignore), дальше обновляется сама.")


def status() -> None:
    if not sb.SESSION_FILE.exists():
        print("Сессии нет — нужен вход.")
        return
    s = json.loads(sb.SESSION_FILE.read_text(encoding="utf-8"))
    left = int(s.get("expires_at", 0) - time.time())
    print(f"Пользователь: {s['user']['email']}  id={s['user']['id']}")
    print(f"Токен живёт ещё {left // 60} мин (обновляется автоматически).")
    c = sb.Client()
    rows = c.select("profiles", select="id,display_name,current_season")
    print("Профиль в базе:", json.dumps(rows, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "request":
        request(sys.argv[2])
    elif cmd == "verify":
        verify(sys.argv[2])
    elif cmd == "accept":
        accept(sys.argv[2])
    elif cmd == "status":
        status()
    else:
        raise SystemExit(__doc__)
