"""Расставляет вещам раздел 2 уровня (subcategory) и первичный сезон.

Источник правды — база: карточки, которые владелец уже проверил (verified = true),
скрипт не трогает никогда. Подраздел определяется по названию вещи, сезон —
по температурному диапазону; и то и другое владелец правит при верификации.

    python tools/classify_items.py --dry-run     посмотреть, что получится
    python tools/classify_items.py               записать в базу
    python tools/classify_items.py --force       переписать и проверенные вещи

Запускать из корня clothes/. Нужен вход: .claude/skills/wardrobe-stylist/scripts/login.py
"""

from __future__ import annotations

import argparse
import collections
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / ".claude/skills/wardrobe-stylist/scripts"))
import sb as S  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

SECTIONS_JS = pathlib.Path(__file__).resolve().parents[1] / "docs" / "sections.js"

# Порядок важен: «Куртка-плащ» должна стать плащом, а не курткой.
RULES: list[tuple[str, str]] = [
    (r"майка", "tank"),
    (r"футболка", "tshirt"),
    (r"лонгслив", "longsleeve"),
    (r"поло(?!\w)", "polo"),
    (r"оверширт", "overshirt"),
    (r"рубашка", "shirt"),
    (r"джемпер|свитер|кофта|флис", "sweater"),
    (r"свитшот", "sweatshirt"),
    (r"худи|толстовка", "hoodie"),
    (r"безрукавка|жилет", "vest"),
    (r"пиджак|блейзер", "blazer"),
    (r"бомбер", "bomber"),
    (r"плащ|ветровка|анорак", "raincoat"),
    (r"пуховик", "puffer"),
    (r"пальто|шинель", "coat"),
    (r"куртка", "jacket"),
    (r"джинсы", "jeans"),
    (r"брюки|чиносы|слаксы", "trousers"),
    (r"шорты", "shorts"),
    (r"(штаны[^,]*спортивн|спортивн[^,]*штаны|джоггеры|треники)", "sweatpants"),
    (r"штаны", "trousers"),
    (r"кроссовки|кеды|сникеры", "sneakers"),
    (r"ботинки|челси|берцы", "boots"),
    (r"туфли|лоферы|монки|дерби", "dress_shoes"),
    (r"сабо|шлёпанцы|шлепанцы|сланцы|crocs", "slides"),
    (r"сумка|рюкзак|барсетка|бананка", "bag"),
    (r"кепка|бейсболка|панама", "cap"),
    (r"шапка|снуд|балаклава|бини", "hat"),
    (r"перчатки|варежки", "gloves"),
    (r"ремень|пояс(?!ная)", "belt"),
    (r"шарф", "scarf"),
]

# Запасной вариант, если название ничего не подсказало.
BY_CATEGORY = {
    "tshirt": "tshirt", "longsleeve": "longsleeve", "polo": "polo", "shirt": "shirt",
    "sweater": "sweater", "sweatshirt": "sweatshirt", "hoodie": "hoodie", "vest": "vest",
    "blazer": "blazer", "jacket": "jacket", "coat": "coat", "suit": "blazer",
    "jeans": "jeans", "trousers": "trousers", "shorts": "shorts", "sweatpants": "sweatpants",
    "shoes": "sneakers", "accessory": "bag",
}


def known_subs() -> set[str]:
    """id подразделов из docs/sections.js — чтобы опечатка не уехала в базу."""
    text = SECTIONS_JS.read_text(encoding="utf-8")
    return set(re.findall(r"\{\s*id:\s*'([a-z_]+)'\s*,\s*label:", text))


def subcategory_of(item: dict) -> tuple[str | None, bool]:
    """Возвращает (подраздел, угадано ли по названию)."""
    title = (item.get("title") or "").lower()
    for pattern, sub in RULES:
        if re.search(pattern, title):
            return sub, True
    return BY_CATEGORY.get(item.get("category")), False


def seasons_of(item: dict) -> list[str]:
    """Первичная раскладка по сезонам из температурного диапазона вещи."""
    lo, hi = item.get("temp_min"), item.get("temp_max")
    if lo is None or hi is None:
        return []
    out = []
    if hi >= 20:
        out.append("summer")
    if lo <= 18 and hi >= 3:
        out.append("demi")
    if lo <= 2:
        out.append("winter")
    return out or ["demi"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="ничего не писать")
    ap.add_argument("--force", action="store_true", help="переписать и проверенные карточки")
    args = ap.parse_args()

    valid = known_subs()
    bad = {sub for _, sub in RULES if sub not in valid} | {s for s in BY_CATEGORY.values() if s not in valid}
    if bad:
        raise SystemExit(f"В правилах есть подразделы, которых нет в sections.js: {sorted(bad)}")

    c = S.Client()
    items = c.select("items", select="id,title,category,temp_min,temp_max,subcategory,seasons,verified",
                     order="title.asc")
    print(f"В базе {len(items)} вещей, проверенных: {sum(1 for i in items if i.get('verified'))}\n")

    counts: collections.Counter = collections.Counter()
    guessed_by_category: list[str] = []
    skipped = 0
    changes: list[tuple[str, dict]] = []

    for item in items:
        if item.get("verified") and not args.force:
            skipped += 1
            continue
        sub, by_title = subcategory_of(item)
        seasons = item.get("seasons") or seasons_of(item)
        counts[sub] += 1
        if not by_title:
            guessed_by_category.append(item["title"])
        patch = {}
        if item.get("subcategory") != sub:
            patch["subcategory"] = sub
        if list(item.get("seasons") or []) != list(seasons):
            patch["seasons"] = seasons
        if patch:
            changes.append((item["id"], patch))

    for sub, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0] or "")):
        print(f"  {sub or '—':14} {n}")
    if guessed_by_category:
        print(f"\nПо названию не опознались ({len(guessed_by_category)}), взял из категории:")
        for t in guessed_by_category:
            print("   ", t)
    if skipped:
        print(f"\nПропущено проверенных вещей: {skipped} (--force перезапишет и их)")

    print(f"\nК записи: {len(changes)} карточек")
    if args.dry_run or not changes:
        print("Это сухой прогон, база не тронута." if args.dry_run else "Менять нечего.")
        return

    for item_id, patch in changes:
        c.update("items", patch, id=f"eq.{item_id}")
    print("Записано.")


if __name__ == "__main__":
    main()
