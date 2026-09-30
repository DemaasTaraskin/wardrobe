"""Выгружает активные вещи из базы в компактный вид — с ним я собираю луки.

  python items_export.py              — таблица в чат (одна строка = одна вещь)
  python items_export.py --json out.json
  python items_export.py --slot base --situation office
  python items_export.py --verified            — только проверенные владельцем
  python items_export.py --unverified          — только ждущие проверки

Проверенные владельцем карточки — источник правды: перед любым push сначала
выгружаем их сюда, а не наоборот.
"""

from __future__ import annotations

import argparse
import json
import sys

import sb

COLS = ("id,source_file,title,brand,category,subcategory,seasons,slots,colors,pattern,"
        "material,logo,formality_min,formality_max,temp_min,temp_max,situations,"
        "water_resistant,wind_resistant,sleeveless,status,verified,notes")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--slot")
    ap.add_argument("--situation")
    ap.add_argument("--status", default="active")
    ap.add_argument("--verified", action="store_true", help="только проверенные владельцем")
    ap.add_argument("--unverified", action="store_true", help="только ждущие проверки")
    args = ap.parse_args()

    c = sb.Client()
    params = {"select": COLS, "limit": "2000", "order": "category,title"}
    if args.status != "any":
        params["status"] = f"eq.{args.status}"
    if args.slot:
        params["slots"] = f"cs.{{{args.slot}}}"
    if args.situation:
        params["situations"] = f"cs.{{{args.situation}}}"
    if args.verified:
        params["verified"] = "is.true"
    if args.unverified:
        params["verified"] = "is.false"
    rows = c.select("items", **params)

    if args.json:
        (sb.ROOT / args.json).write_text(
            json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        sb.say(f"{len(rows)} вещей → {args.json}")
        return 0

    for r in rows:
        mark = "✓" if r.get("verified") else "·"
        sb.say(f"{mark} {r['id'][:8]} {(r.get('subcategory') or r['category']):<12} {'/'.join(r['slots']):<18} "
               f"{r['temp_min']:>4}…{r['temp_max']:<3} f{r['formality_min']}-{r['formality_max']} "
               f"{'+'.join(r['colors']):<14} {','.join(r['situations']):<28} {r['title']}")
    sb.say(f"— всего {len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
