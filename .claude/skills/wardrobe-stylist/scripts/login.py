"""Вход в Supabase по коду на почту. Паролей нет.

  python login.py request <почта>   — просит прислать код (письмо приходит тебе)
  python login.py verify  <код>     — сохраняет сессию в .supabase-session.json
  python login.py status            — кто сейчас в сессии и до какого времени она живёт
"""

from __future__ import annotations

import json
import pathlib
import sys
import time

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
    elif cmd == "status":
        status()
    else:
        raise SystemExit(__doc__)
