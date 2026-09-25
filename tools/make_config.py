"""Собирает docs/config.js из .env.

Ключ publishable (anon) публичен по замыслу — вся защита в RLS (DATA.md §3),
поэтому config.js лежит в репозитории. service_role сюда не попадает никогда.

Запуск из корня clothes/:  python tools/make_config.py
"""
from __future__ import annotations
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
OUT = ROOT / "docs" / "config.js"

env: dict[str, str] = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

url = env.get("SUPABASE_URL", "").rstrip("/")
key = env.get("SUPABASE_PUBLISHABLE_KEY", "")
if not url or not key:
    raise SystemExit("В .env не заполнены SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY")
if "service_role" in key or key.startswith("sb_secret"):
    raise SystemExit("Это похоже на service_role. В сайт идёт только publishable (anon) ключ.")

OUT.write_text(
    "// Собирается командой: python tools/make_config.py — руками не правим.\n"
    "// Ключ publishable (anon): он публичен по замыслу, вся защита в RLS (DATA.md §3).\n"
    f"export const SUPABASE_URL = {url!r};\n".replace("'", '"')
    + f"export const SUPABASE_PUBLISHABLE_KEY = {key!r};\n".replace("'", '"'),
    encoding="utf-8",
)
print(f"docs/config.js собран: url {len(url)} символов, ключ {len(key)} символов")
