"""wardrobe looks — проверяет собранные луки по правилам и пишет их в базу.

  python looks_push.py looks_batch1.json --dry-run   — только проверка
  python looks_push.py looks_batch1.json             — проверка и запись
  python looks_push.py --coverage                    — таблица покрытия 5 ситуаций × 3 банда
  python looks_push.py looks_batch2.json --retire-existing   — вторая партия вместо первой

Формат файла с луками:
{
  "season": "2026-autumn",
  "batch": 1,
  "looks": [
    {"situation": "office", "temp_min": 10, "temp_max": 15,
     "why": "Почему работает, 1–3 предложения.",
     "items": {"base": "IMG_1.png", "layer2": "IMG_2.png", "outer": "IMG_3.png",
               "bottom": "IMG_4.png", "shoes": "IMG_5.png",
               "accessory": ["IMG_6.png"]}}
  ],
  "gaps": [{"situation": "gym", "temp_min": 5, "temp_max": 10, "rain_ok": true,
            "missing": "чего не хватило"}]
}
Вещи указываются по source_file (имя файла фото) или по id. rain_ok у лука не пишется
руками — считается сам: лук годится в дождь, если в нём есть рукава.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict

import sb

SITUATIONS = ["gym", "dog", "office", "weekend", "evening"]
BANDS = [(5, 10), (10, 15), (15, 20)]
REQUIRED_SLOTS = ["base", "bottom", "shoes"]
SLOT_ORDER = ["base", "layer2", "outer", "bottom", "shoes", "accessory"]
SLOT_CATEGORIES = {
    "base": {"tshirt", "longsleeve", "polo", "shirt", "sweater", "sweatshirt", "hoodie"},
    "layer2": {"shirt", "sweater", "sweatshirt", "hoodie", "vest", "blazer"},
    "outer": {"hoodie", "blazer", "jacket", "coat"},
    "bottom": {"jeans", "trousers", "shorts", "sweatpants"},
    "shoes": {"shoes"},
    "accessory": {"accessory"},
}
NEUTRAL = {"black", "white", "ecru", "grey", "beige", "navy"}
FIGURED = {"print", "stripe", "check"}


def check_look(look: dict, by_ref: dict) -> tuple[list[str], list[str], dict]:
    """Возвращает (ошибки, предупреждения, разобранный состав slot → [вещь])."""
    errors: list[str] = []
    warns: list[str] = []
    comp: dict[str, list[dict]] = {}

    if look["situation"] not in SITUATIONS:
        errors.append(f"ситуация {look['situation']} не из списка")
    band = (look["temp_min"], look["temp_max"])
    if band not in BANDS:
        warns.append(f"банд {band[0]}…{band[1]} не из трёх текущих")
    if not look.get("why", "").strip():
        errors.append("пустое «почему работает»")

    raw = look.get("items") or {}
    for slot, ref in raw.items():
        if slot not in SLOT_ORDER:
            errors.append(f"неизвестный слот {slot}")
            continue
        refs = ref if isinstance(ref, list) else [ref]
        if slot != "accessory" and len(refs) > 1:
            errors.append(f"в слоте {slot} больше одной вещи")
        if slot == "accessory" and len(refs) > 2:
            errors.append("аксессуаров больше двух")
        picked = []
        for r in refs:
            it = by_ref.get(r)
            if not it:
                errors.append(f"вещь не найдена: {r}")
                continue
            picked.append(it)
        comp[slot] = picked

    for slot in REQUIRED_SLOTS:
        if not comp.get(slot):
            errors.append(f"не заполнен обязательный слот {slot}")
    if look["temp_max"] <= 15 and not comp.get("outer"):
        errors.append(f"на {band[0]}…{band[1]} нужен слой outer")

    flat = [(slot, it) for slot in SLOT_ORDER for it in comp.get(slot, [])]
    seen: dict[str, str] = {}
    for slot, it in flat:
        if it["id"] in seen:
            errors.append(f"{it['title']} стоит и в {seen[it['id']]}, и в {slot}")
        seen[it["id"]] = slot
        if it["status"] != "active":
            errors.append(f"{it['title']} в статусе {it['status']}")
        if slot not in it["slots"]:
            errors.append(f"{it['title']} не может стоять в слоте {slot} (её слоты: {'/'.join(it['slots'])})")
        elif it["category"] not in SLOT_CATEGORIES[slot]:
            warns.append(f"{it['title']}: категория {it['category']} необычна для слота {slot}")
        if look["situation"] not in it["situations"]:
            errors.append(f"{it['title']} не для ситуации {look['situation']}")
        if it["temp_max"] < band[0] or it["temp_min"] > band[1]:
            errors.append(f"{it['title']} ({it['temp_min']}…{it['temp_max']}) "
                          f"не пересекается с бандом {band[0]}…{band[1]}")
        elif it["temp_min"] > band[0] or it["temp_max"] < band[1]:
            warns.append(f"{it['title']} закрывает банд не целиком ({it['temp_min']}…{it['temp_max']})")

    if flat:
        f_lo = max(it["formality_min"] for _, it in flat)
        f_hi = min(it["formality_max"] for _, it in flat)
        if f_lo > f_hi:
            errors.append("формальности вещей не пересекаются — "
                          + ", ".join(f"{it['title']} {it['formality_min']}-{it['formality_max']}"
                                      for _, it in flat))
        elif f_lo >= 3:
            loud = [it["title"] for _, it in flat if it["logo"] != "none"]
            if loud:
                errors.append(f"с формальности {f_lo} логотипов быть не должно: {', '.join(loud)}")

        figured = [it["title"] for _, it in flat if it["pattern"] in FIGURED]
        if len(figured) > 1:
            errors.append(f"больше одного рисунка: {', '.join(figured)}")

        bright = {c for _, it in flat for c in it["colors"] if c not in NEUTRAL}
        if len(bright) > 2:
            warns.append(f"цветов вне нейтральной базы {len(bright)}: {', '.join(sorted(bright))}")

    layers = [it for slot in ("base", "layer2", "outer") for it in comp.get(slot, [])]
    rain_ok = any(not it["sleeveless"] for it in layers)
    look["_rain_ok"] = rain_ok
    look["_comp"] = comp
    return errors, warns, comp


def coverage(c: sb.Client, season: str) -> None:
    looks = c.select("looks", select="situation,temp_min,temp_max,rain_ok,status",
                     season=f"eq.{season}", status="eq.active", limit="1000")
    gaps = c.select("gaps", select="situation,temp_min,temp_max", season=f"eq.{season}", limit="1000")
    grid: dict = defaultdict(list)
    for l in looks:
        grid[(l["situation"], l["temp_min"], l["temp_max"])].append(l)
    gapcells = {(g["situation"], g["temp_min"], g["temp_max"]) for g in gaps}

    sb.say(f"\nПокрытие сезона {season} (в скобках — сколько из них годятся в дождь):")
    sb.say("ситуация   " + "".join(f"  {a}…{b}".ljust(12) for a, b in BANDS))
    for s in SITUATIONS:
        cells = []
        for band in BANDS:
            got = grid[(s, *band)]
            mark = "—" if not got else f"{len(got)} ({sum(1 for l in got if l['rain_ok'])})"
            if not got and (s, *band) in gapcells:
                mark = "пробел"
            cells.append(mark.ljust(12))
        sb.say(f"{s:<11}" + "".join(cells))
    sb.say(f"Всего луков: {len(looks)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--retire-existing", action="store_true")
    ap.add_argument("--coverage", action="store_true")
    ap.add_argument("--season", default="2026-autumn")
    args = ap.parse_args()

    c = sb.Client()
    if not args.file:
        coverage(c, args.season)
        return 0

    data = json.loads((sb.ROOT / args.file).read_text(encoding="utf-8"))
    season = data.get("season", args.season)
    batch = int(data.get("batch", 1))

    items = c.select("items", select="id,source_file,title,category,slots,colors,pattern,logo,"
                                     "formality_min,formality_max,temp_min,temp_max,situations,"
                                     "sleeveless,status,water_resistant", limit="2000")
    by_ref = {}
    for it in items:
        by_ref[it["source_file"]] = it
        by_ref[it["id"]] = it
        by_ref[it["title"]] = it

    bad = 0
    for n, look in enumerate(data["looks"], 1):
        errors, warns, _ = check_look(look, by_ref)
        head = f"[{n}] {look['situation']} {look['temp_min']}…{look['temp_max']}"
        if errors:
            bad += 1
            sb.say(f"✗ {head}")
            for e in errors:
                sb.say(f"    ошибка: {e}")
        elif warns:
            sb.say(f"~ {head}" + ("  дождь" if look["_rain_ok"] else ""))
        else:
            sb.say(f"✓ {head}" + ("  дождь" if look["_rain_ok"] else ""))
        for w in warns:
            sb.say(f"    заметка: {w}")

    sb.say(f"\nПроверено {len(data['looks'])} луков, с ошибками {bad}.")
    if bad:
        sb.say("Ничего не записано — сначала правим состав.")
        return 1
    if args.dry_run:
        sb.say("Сухой прогон: в базу не писал.")
        return 0

    if args.retire_existing:
        c.update("looks", {"status": "retired"},
                 season=f"eq.{season}", status="eq.active")
        sb.say(f"Прежние активные луки сезона {season} переведены в retired.")

    written = 0
    for look in data["looks"]:
        row = c.insert("looks", [{
            "user_id": c.user_id, "season": season, "situation": look["situation"],
            "temp_min": look["temp_min"], "temp_max": look["temp_max"],
            "rain_ok": look["_rain_ok"], "why": look["why"].strip(), "batch": batch,
        }])[0]
        payload = []
        for slot in SLOT_ORDER:
            for pos, it in enumerate(look["_comp"].get(slot, [])):
                payload.append({"look_id": row["id"], "item_id": it["id"],
                                "slot": slot, "position": pos, "user_id": c.user_id})
        try:
            c.insert("look_items", payload, prefer="return=minimal")
        except sb.SupabaseError:
            c.delete("looks", id=f"eq.{row['id']}")  # не оставляем лук без состава
            raise
        written += 1
    sb.say(f"Записано луков: {written}")

    gaps = data.get("gaps") or []
    if gaps:
        c.upsert("gaps", [{"user_id": c.user_id, "season": season, **g} for g in gaps],
                 on_conflict="user_id,season,situation,temp_min,temp_max,rain_ok",
                 prefer="return=minimal")
        sb.say(f"Пробелов записано: {len(gaps)}")

    coverage(c, season)
    return 0


if __name__ == "__main__":
    sys.exit(main())
