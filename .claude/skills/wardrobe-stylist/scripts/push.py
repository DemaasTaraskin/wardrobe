"""wardrobe push — заливает локальный каталог и фото в Supabase.

  python push.py                 — сжать фото, залить, создать/обновить карточки
  python push.py --dry-run       — только показать, что произойдёт
  python push.py --limit 3       — пробный прогон на нескольких вещах
  python push.py --photos skip   — только карточки, без фото
  python push.py --cards skip    — только фото, карточки не трогать
  python push.py --photos all    — перезалить все фото, даже неизменившиеся

  python push.py --force-verified — переписать и то, что владелец уже проверил

Вещь узнаётся по source_file: повторный запуск правит карточку, а не плодит вторую.
Карточки с verified = true скрипт не трогает: их проверил владелец в приложении,
и они для нас вход, а не выход. Фото заливаются всем.
Оригиналы из wardrobe-photos никуда не копируются — в базу идёт сжатая копия
(~800 px, WebP с прозрачностью).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import pathlib
import sys

import sb

CATALOG = sb.ROOT / "wardrobe.json"
CACHE = sb.ROOT / ".webp-cache"
STATE = sb.ROOT / ".wardrobe-push-state.json"
MAX_SIDE = 800
QUALITY = 82
FILL = 0.92  # какую долю квадрата занимает вещь

FIELDS = [
    "source_file", "title", "brand", "category", "subcategory", "seasons",
    "slots", "colors", "pattern",
    "material", "logo", "formality_min", "formality_max", "temp_min", "temp_max",
    "situations", "water_resistant", "wind_resistant", "sleeveless", "status",
    "board_group", "board_caption", "notes",
]


def to_webp(src: pathlib.Path) -> bytes:
    """Обрезает прозрачные поля, вписывает вещь в квадрат по центру и сжимает.

    Исходники сняты на вертикальном холсте 2000×2666, а вещь занимает только
    верхнюю часть — в сетке это выглядело как разнобой. Бенчмарк — бомбер Diesel,
    у которого холст обрезан по вещи.
    """
    from PIL import Image

    CACHE.mkdir(exist_ok=True)
    cached = CACHE / (src.stem + "-sq.webp")
    if cached.exists() and cached.stat().st_mtime >= src.stat().st_mtime:
        return cached.read_bytes()
    with Image.open(src) as im:
        im = im.convert("RGBA")
        box = im.getchannel("A").getbbox()  # по прозрачности, а не по цвету
        if box:
            im = im.crop(box)
        inner = int(MAX_SIDE * FILL)
        im.thumbnail((inner, inner), Image.LANCZOS)
        canvas = Image.new("RGBA", (MAX_SIDE, MAX_SIDE), (0, 0, 0, 0))
        canvas.paste(im, ((MAX_SIDE - im.width) // 2, (MAX_SIDE - im.height) // 2))
        buf = io.BytesIO()
        canvas.save(buf, "WEBP", quality=QUALITY, method=6)
    data = buf.getvalue()
    cached.write_bytes(data)
    return data


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--photos", choices=["auto", "skip", "all"], default="auto")
    ap.add_argument("--cards", choices=["write", "skip"], default="write",
                    help="skip — не трогать карточки, залить только фото")
    ap.add_argument("--force-verified", action="store_true",
                    help="переписать карточки, которые владелец уже проверил")
    args = ap.parse_args()

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    items = catalog["items"]
    if args.limit:
        items = items[: args.limit]

    # сверка каталога с папкой фото
    photos = {p.name: p for p in sb.PHOTOS_DIR.iterdir() if p.is_file()}
    no_photo = [i["source_file"] for i in items if i["source_file"] not in photos]
    no_card = sorted(set(photos) - {i["source_file"] for i in catalog["items"]})
    if no_photo:
        sb.say(f"! {len(no_photo)} карточек без фото: {', '.join(no_photo[:5])}")
    if no_card:
        sb.say(f"! {len(no_card)} фото без карточки: {', '.join(no_card[:5])}")

    if args.dry_run:
        sb.say(f"Сухой прогон: {len(items)} карточек, фото в {sb.PHOTOS_DIR}")
        sizes = [len(to_webp(photos[i['source_file']])) for i in items if i["source_file"] in photos]
        if sizes:
            sb.say(f"Сжатие: {len(sizes)} фото, всего {sum(sizes) / 1e6:.1f} МБ, "
                   f"в среднем {sum(sizes) / len(sizes) / 1024:.0f} КБ")
        return 0

    c = sb.Client()
    sb.say(f"Вход: {c.email}")
    existing = {r["source_file"]: r for r in
                c.select("items", select="id,source_file,photo_path,verified", limit="2000")}

    # проверенное владельцем — источник правды, каталогом не перезаписываем
    protected = {i["source_file"] for i in items
                 if existing.get(i["source_file"], {}).get("verified")} if not args.force_verified else set()

    rows = []
    for i in items:
        if args.cards == "skip" or i["source_file"] in protected:
            continue
        # только то, что в каталоге реально есть: иначе пустой ключ затрёт
        # поле, проставленное скриптом разметки или приложением
        row = {k: i[k] for k in FIELDS if k in i}
        row["user_id"] = c.user_id
        rows.append(row)

    saved = []
    if args.cards == "skip":
        sb.say("Карточки не трогаю (--cards skip)")
    for chunk in (rows[k:k + 50] for k in range(0, len(rows), 50)):
        saved += c.upsert("items", chunk, on_conflict="user_id,source_file",
                          prefer="return=representation") or []
    added = [r for r in saved if r["source_file"] not in existing]
    sb.say(f"Карточки: добавлено {len(added)}, обновлено {len(saved) - len(added)}")
    if protected:
        sb.say(f"Не тронуто проверенных владельцем: {len(protected)} "
               f"(--force-verified перезапишет и их)")

    # фото заливаем всем, включая проверенные и пропущенные: фото правит только push
    covered = {r["source_file"] for r in saved}
    saved += [existing[i["source_file"]] for i in items
              if i["source_file"] in existing and i["source_file"] not in covered]

    if args.photos == "skip":
        return 0

    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    uploaded = skipped = 0
    for row in saved:
        src = photos.get(row["source_file"])
        if not src:
            continue
        data = to_webp(src)
        digest = hashlib.sha256(data).hexdigest()
        path = f"{c.user_id}/items/{row['id']}.webp"
        if args.photos == "auto" and state.get(row["source_file"]) == digest \
                and row.get("photo_path") == path:
            skipped += 1
            continue
        c.upload(path, data)
        if row.get("photo_path") != path:
            c.update("items", {"photo_path": path}, id=f"eq.{row['id']}")
        state[row["source_file"]] = digest
        uploaded += 1
        if uploaded % 10 == 0:
            sb.say(f"  … залито {uploaded}")
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    sb.say(f"Фото: залито {uploaded}, без изменений {skipped}")

    total = c.select("items", select="id", limit="2000")
    sb.say(f"Всего в базе карточек: {len(total)}")

    # пробелы гардероба, замеченные при разборе каталога (этап 2)
    gaps = catalog.get("gaps") or []
    if gaps and not args.limit:
        payload = [{"user_id": c.user_id, "season": catalog["season"],
                    "situation": g["situation"], "temp_min": g["temp_min"],
                    "temp_max": g["temp_max"], "rain_ok": g.get("rain_ok"),
                    "missing": g["missing"]} for g in gaps]
        c.upsert("gaps", payload,
                 on_conflict="user_id,season,situation,temp_min,temp_max,rain_ok",
                 prefer="return=minimal")
        sb.say(f"Пробелы гардероба: записано {len(payload)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
