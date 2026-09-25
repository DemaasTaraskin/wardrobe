"""Общая часть скила wardrobe-stylist: ключи, сессия, запросы к Supabase.

Только стандартная библиотека — ничего ставить не нужно.
Секреты берутся из clothes/.env, сессия лежит в clothes/.supabase-session.json
(оба файла в .gitignore).
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

for _stream in (sys.stdout, sys.stderr):  # консоль Windows иначе спотыкается о кириллицу
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

ROOT = pathlib.Path(__file__).resolve().parents[4]  # …/clothes
ENV_FILE = ROOT / ".env"
SESSION_FILE = ROOT / ".supabase-session.json"
PHOTOS_DIR = pathlib.Path(os.environ.get("WARDROBE_PHOTOS", r"C:\Users\manyl\wardrobe-photos"))
BUCKET = "wardrobe"


class SupabaseError(RuntimeError):
    def __init__(self, status: int, body: str, where: str = ""):
        self.status = status
        self.body = body
        super().__init__(f"{where} → HTTP {status}: {body[:500]}")


# ---------------------------------------------------------------- ключи

def load_env() -> dict[str, str]:
    if not ENV_FILE.exists():
        raise SystemExit(f"Нет файла {ENV_FILE}. Впиши в него SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY.")
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    for key in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"):
        if not env.get(key):
            raise SystemExit(f"В {ENV_FILE} не заполнен {key}.")
    env["SUPABASE_URL"] = env["SUPABASE_URL"].rstrip("/")
    return env


# ---------------------------------------------------------------- HTTP

def _request(method: str, url: str, *, headers: dict[str, str], body=None,
             timeout: int = 120) -> tuple[int, bytes, dict]:
    data = None
    headers = dict(headers)
    if isinstance(body, (dict, list)):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    elif isinstance(body, bytes):
        data = body
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


class Client:
    """Клиент Supabase, работающий от имени владельца (сессия из .supabase-session.json)."""

    def __init__(self, anonymous: bool = False):
        env = load_env()
        self.url = env["SUPABASE_URL"]
        self.key = env["SUPABASE_PUBLISHABLE_KEY"]
        self.session: dict | None = None
        if not anonymous:
            self.session = self._load_session()

    # -- сессия ---------------------------------------------------

    def _load_session(self) -> dict:
        if not SESSION_FILE.exists():
            raise SystemExit(
                "Нет сохранённой сессии. Выполни вход:\n"
                "  python .claude/skills/wardrobe-stylist/scripts/login.py request <почта>\n"
                "  python .claude/skills/wardrobe-stylist/scripts/login.py verify <код из письма>"
            )
        s = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
        if s.get("expires_at", 0) - time.time() < 120:
            s = self.refresh(s)
        return s

    def save_session(self, s: dict) -> dict:
        s.setdefault("expires_at", int(time.time()) + int(s.get("expires_in", 3600)))
        SESSION_FILE.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")
        try:  # на Windows игнорируется, на Linux/Mac прячем от чужих глаз
            os.chmod(SESSION_FILE, 0o600)
        except OSError:
            pass
        self.session = s
        return s

    def refresh(self, s: dict) -> dict:
        status, raw, _ = _request(
            "POST", f"{self.url}/auth/v1/token?grant_type=refresh_token",
            headers={"apikey": self.key}, body={"refresh_token": s["refresh_token"]})
        if status >= 400:
            raise SystemExit(
                "Сессия протухла, нужен повторный вход:\n"
                "  python .claude/skills/wardrobe-stylist/scripts/login.py request <почта>\n"
                f"(ответ сервера: {raw.decode('utf-8', 'replace')[:200]})")
        return self.save_session(json.loads(raw))

    @property
    def user_id(self) -> str:
        return self.session["user"]["id"]

    @property
    def email(self) -> str:
        return self.session["user"].get("email", "")

    def _auth_headers(self) -> dict[str, str]:
        token = self.session["access_token"] if self.session else self.key
        return {"apikey": self.key, "Authorization": f"Bearer {token}"}

    # -- REST -----------------------------------------------------

    def rest(self, method: str, table: str, *, params: dict | None = None,
             body=None, prefer: str | None = None):
        url = f"{self.url}/rest/v1/{table}"
        if params:
            url += "?" + urllib.parse.urlencode(params, safe="*,()!.:")
        headers = self._auth_headers()
        if prefer:
            headers["Prefer"] = prefer
        status, raw, _ = _request(method, url, headers=headers, body=body)
        if status == 401 and self.session:
            self.refresh(self.session)
            headers = self._auth_headers()
            if prefer:
                headers["Prefer"] = prefer
            status, raw, _ = _request(method, url, headers=headers, body=body)
        if status >= 400:
            raise SupabaseError(status, raw.decode("utf-8", "replace"), f"{method} {table}")
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw.decode("utf-8", "replace")

    def select(self, table: str, **params):
        return self.rest("GET", table, params=params) or []

    def insert(self, table: str, rows, prefer="return=representation"):
        return self.rest("POST", table, body=rows, prefer=prefer)

    def upsert(self, table: str, rows, on_conflict: str, prefer="return=representation"):
        return self.rest("POST", table, params={"on_conflict": on_conflict}, body=rows,
                         prefer=f"resolution=merge-duplicates,{prefer}")

    def update(self, table: str, patch: dict, **filters):
        return self.rest("PATCH", table, params=filters, body=patch,
                         prefer="return=representation")

    def delete(self, table: str, **filters):
        return self.rest("DELETE", table, params=filters, prefer="return=minimal")

    # -- Storage --------------------------------------------------

    def upload(self, path: str, data: bytes, content_type: str = "image/webp") -> str:
        url = f"{self.url}/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}"
        headers = self._auth_headers() | {"Content-Type": content_type, "x-upsert": "true"}
        status, raw, _ = _request("POST", url, headers=headers, body=data)
        if status == 401 and self.session:
            self.refresh(self.session)
            headers = self._auth_headers() | {"Content-Type": content_type, "x-upsert": "true"}
            status, raw, _ = _request("POST", url, headers=headers, body=data)
        if status >= 400:
            raise SupabaseError(status, raw.decode("utf-8", "replace"), f"upload {path}")
        return path

    def sign_url(self, path: str, expires_in: int = 3600) -> str:
        url = f"{self.url}/storage/v1/object/sign/{BUCKET}/{urllib.parse.quote(path)}"
        status, raw, _ = _request("POST", url, headers=self._auth_headers(),
                                  body={"expiresIn": expires_in})
        if status >= 400:
            raise SupabaseError(status, raw.decode("utf-8", "replace"), f"sign {path}")
        return self.url + "/storage/v1" + json.loads(raw)["signedURL"]

    def list_objects(self, prefix: str) -> list[dict]:
        url = f"{self.url}/storage/v1/object/list/{BUCKET}"
        status, raw, _ = _request("POST", url, headers=self._auth_headers(),
                                  body={"prefix": prefix, "limit": 1000})
        if status >= 400:
            raise SupabaseError(status, raw.decode("utf-8", "replace"), "list objects")
        return json.loads(raw)


# ---------------------------------------------------------------- вывод

def say(*parts):
    print(*parts, flush=True)
