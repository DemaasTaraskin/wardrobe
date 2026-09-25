"""Выгружает активные вещи из базы в компактный вид — с ним я собираю луки.

  python items_export.py              — таблица в чат (одна строка = одна вещь)
  python items_export.py --json out.json
  python items_export.py --slot base --situation office
"""

from __future__ import annotations

import argparse
import json
import sys

import sb

COLS = ("id,source_file,title,brand,category,slots,colors,pattern,material,logo,"
        "formality_min,formality_max,temp_min,temp_max,situations,"
        "water_resistant,wind_resistant,sleeveless,status,notes")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--slot")
    ap.add_argument("--situation")
    ap.add_argument("--status", default="active")
    args = ap.parse_args()

    c = sb.Client()
    params = {"select": COLS, "limit": "2000", "order": "category,title"}
    if args.status != "any":
        params["status"] = f"eq.{args.status}"
    if args.slot:
        params["slots"] = f"cs.{{{args.slot}}}"
    if args.situation:
        params["situations"] = f"cs.{{{args.situation}}}"
    rows = c.select("items", **params)

    if args.json:
        (sb.ROOT / args.json).write_text(
            json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        sb.say(f"{len(rows)} вещей → {args.json}")
        return 0

    for r in rows:
        sb.say(f"{r['id'][:8]} {r['category']:<11} {'/'.join(r['slots']):<18} "
               f"{r['temp_min']:>4}…{r['temp_max']:<3} f{r['formality_min']}-{r['formality_max']} "
               f"{'+'.join(r['colors']):<14} {','.join(r['situations']):<28} {r['title']}")
    sb.say(f"— всего {len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
