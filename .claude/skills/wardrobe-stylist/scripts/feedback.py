"""wardrobe feedback — выгружает оценки и журнал «надел», считает сводку.

  python feedback.py                 — сводка в чат и в feedback.md
  python feedback.py --season 2026-autumn

feedback.md остаётся локально (в .gitignore) — это черновик для разбора на этапе 6.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from collections import Counter

import sb

REASON_RU = {
    "hot": "жарко", "cold": "холодно", "wrong_situation": "не по ситуации",
    "colors": "цвета не дружат", "not_my_style": "не мой стиль", "uncomfortable": "неудобно",
}
SELECT = ("id,situation,temp_min,temp_max,rain_ok,why,batch,status,created_at,"
          "ratings(verdict,reasons,comment,updated_at),"
          "wear_log(worn_on,temp_c,situation,rain),"
          "look_items(slot,position,items(id,title,category))")


def name(look: dict) -> str:
    parts = {li["slot"]: li["items"]["title"] for li in sorted(
        look["look_items"], key=lambda x: (x["slot"], x["position"]))}
    order = ["base", "layer2", "outer", "bottom", "shoes", "accessory"]
    return " + ".join(parts[s] for s in order if s in parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026-autumn")
    args = ap.parse_args()

    c = sb.Client()
    looks = c.select("looks", select=SELECT, season=f"eq.{args.season}",
                     order="situation,temp_min", limit="1000")
    items = c.select("items", select="id,title,category,status", status="eq.active", limit="2000")

    rated = [l for l in looks if l["ratings"]]
    loved = [l for l in rated if l["ratings"][0]["verdict"] == "love"]
    worn = [(w, l) for l in looks for w in l["wear_log"]]
    reasons = Counter(r for l in rated for r in (l["ratings"][0]["reasons"] or []))

    in_looks = {li["items"]["id"] for l in looks for li in l["look_items"]}
    in_worn = {li["items"]["id"] for _, l in worn for li in l["look_items"]}
    never_in_look = [i for i in items if i["id"] not in in_looks]
    never_worn = [i for i in items if i["id"] in in_looks and i["id"] not in in_worn]

    days = sorted({w["worn_on"] for w, _ in worn})
    span = ""
    if days:
        d0 = dt.date.fromisoformat(days[0])
        span = f" с {d0.strftime('%d.%m')} ({(dt.date.today() - d0).days + 1} дн.)"

    out = [f"# Отзывы по сезону {args.season}", "",
           f"Выгружено {dt.date.today().isoformat()}.", "",
           "## Коротко", "",
           f"- луков всего: {len(looks)}, оценено: {len(rated)}",
           f"- ❤️ {len(loved)} из {len(rated)}"
           + (f" — {len(loved) * 100 // len(rated)}%" if rated else ""),
           f"- дней с записью «надел»: {len(days)}{span}",
           f"- всего надеваний: {len(worn)}",
           f"- активных вещей, не попавших ни в один лук: {len(never_in_look)}",
           f"- вещей в луках, которые ни разу не надеты: {len(never_worn)}", ""]

    if reasons:
        out += ["## Почему 👎", ""]
        out += [f"- {REASON_RU.get(r, r)}: {n}" for r, n in reasons.most_common()] + [""]

    comments = [(l, l["ratings"][0]) for l in rated if (l["ratings"][0]["comment"] or "").strip()]
    if comments:
        out += ["## Комментарии", ""]
        for l, r in comments:
            mark = "❤️" if r["verdict"] == "love" else "👎"
            out.append(f"- {mark} **{l['situation']} {l['temp_min']}…{l['temp_max']}** — "
                       f"{r['comment'].strip()}  \n  <sub>{name(l)}</sub>")
        out.append("")

    if worn:
        out += ["## Журнал «надел»", "", "| дата | ситуация | °C | дождь | лук |", "|---|---|---|---|---|"]
        for w, l in sorted(worn, key=lambda x: x[0]["worn_on"], reverse=True):
            out.append(f"| {w['worn_on']} | {w['situation'] or l['situation']} | "
                       f"{w['temp_c'] if w['temp_c'] is not None else ''} | "
                       f"{'да' if w['rain'] else ''} | {name(l)} |")
        out.append("")

    by_cell = Counter((l["situation"], l["temp_min"]) for l in looks)
    worn_cell = Counter((l["situation"], l["temp_min"]) for _, l in worn)
    out += ["## Ячейки", "", "| ситуация | банд | луков | надето |", "|---|---|---|---|"]
    for (s, t), n in sorted(by_cell.items()):
        out.append(f"| {s} | {t}…{t + 5} | {n} | {worn_cell[(s, t)]} |")
    out.append("")

    if never_in_look:
        out += ["## Лежит без дела (нет ни в одном луке)", ""]
        out += [f"- {i['title']} ({i['category']})" for i in never_in_look] + [""]
    if never_worn:
        out += ["## Есть в луках, но не надето", ""]
        out += [f"- {i['title']}" for i in never_worn] + [""]

    unrated = [l for l in looks if not l["ratings"]]
    if unrated:
        out += ["## Без оценки", ""]
        out += [f"- {l['situation']} {l['temp_min']}…{l['temp_max']}: {name(l)}" for l in unrated] + [""]

    path = sb.ROOT / "feedback.md"
    path.write_text("\n".join(out), encoding="utf-8")

    sb.say(f"Луков {len(looks)}, оценено {len(rated)}, ❤️ {len(loved)}"
           + (f" ({len(loved) * 100 // len(rated)}%)" if rated else ""))
    sb.say(f"Надеваний {len(worn)} за {len(days)} дн.; "
           f"вещей без единого лука {len(never_in_look)}, без единого выхода {len(never_worn)}")
    if reasons:
        sb.say("Причины 👎: " + ", ".join(f"{REASON_RU.get(r, r)}×{n}" for r, n in reasons.most_common()))
    sb.say(f"Подробности → {path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
