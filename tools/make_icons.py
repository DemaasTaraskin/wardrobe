"""Рисует иконки приложения: python tools/make_icons.py

Вешалка описана один раз, в квадрате 1024×1024, и рисуется двумя ломаными —
крюк со стойкой и плечики. Поэтому стыки получаются скруглёнными, а не
ступенькой: прошлые иконки были собраны из отдельных кусков и разъезжались.

Что на выходе (docs/icons/):
  icon-192.png, icon-512.png   — скруглённый квадрат, углы прозрачные
  icon-maskable-512.png        — во весь квадрат: Android режет иконку сам
  apple-touch-icon.png         — во весь квадрат: iOS тоже режет сам

Нужен только Pillow.
"""

from __future__ import annotations

import math
import pathlib
import sys

from PIL import Image, ImageDraw

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

OUT = pathlib.Path(__file__).resolve().parents[1] / "docs" / "icons"
GREEN = (47, 93, 80, 255)      # --accent
CREAM = (250, 249, 247, 255)   # --bg
SS = 4                          # сглаживание: рисуем вчетверо крупнее и ужимаем

# ---------------------------------------------------------------- вешалка

BOX = 1024        # сторона квадрата, в котором описана вешалка
W = 56            # толщина линии
BAR_Y = 712       # перекладина
BAR_X0, BAR_X1 = 208, 816
APEX = (512, 476)  # вершина плечиков
NECK_TOP = 388     # где стойка переходит в крюк
HOOK_R = 76        # радиус крюка
HOOK_CX = 588      # центр крюка: правее стойки ровно на радиус
HOOK_TAIL = 428    # докуда опускается кончик крюка


def hanger_paths() -> list[list[tuple[float, float]]]:
    """Две ломаные: плечики с перекладиной и стойка с крюком."""
    shoulders = [(BAR_X0, BAR_Y), APEX, (BAR_X1, BAR_Y)]
    bar = [(BAR_X0, BAR_Y), (BAR_X1, BAR_Y)]

    hook = [APEX, (512, NECK_TOP)]
    for deg in range(180, -1, -3):          # полукруг через верх, слева направо
        t = math.radians(deg)
        hook.append((HOOK_CX + HOOK_R * math.cos(t), NECK_TOP - HOOK_R * math.sin(t)))
    hook.append((HOOK_CX + HOOK_R, HOOK_TAIL))
    return [shoulders, bar, hook]


def densify(pts: list[tuple[float, float]], step: float) -> list[tuple[float, float]]:
    """Разбивает ломаную на точки не дальше step друг от друга."""
    out: list[tuple[float, float]] = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / step))
        out += [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(n + 1)]
    return out


def draw_hanger(d: ImageDraw.ImageDraw, size: int, glyph: float) -> None:
    """Рисует вешалку по центру квадрата size×size, занимая долю glyph от него.

    Линия — это след круглой кисти: ставим кружок через каждые полпикселя.
    `ImageDraw.line(joint="curve")` на крутой дуге оставляет щели по внешнему
    краю, и крюк выходит мохнатым.
    """
    k = size / BOX * glyph
    off = (size - BOX * k) / 2
    r = max(1.0, W * k / 2)

    for path in hanger_paths():
        pts = [(off + x * k, off + y * k) for x, y in path]
        for x, y in densify(pts, 0.5):
            d.ellipse((x - r, y - r, x + r, y + r), fill=CREAM)


# ---------------------------------------------------------------- иконки

def icon(size: int, *, rounded: bool, glyph: float) -> Image.Image:
    big = size * SS
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.2237), fill=GREEN)
    else:
        d.rectangle((0, 0, big - 1, big - 1), fill=GREEN)
    draw_hanger(d, big, glyph)
    return im.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    made = [
        ("icon-192.png", icon(192, rounded=True, glyph=1.0), "RGBA"),
        ("icon-512.png", icon(512, rounded=True, glyph=1.0), "RGBA"),
        # Android вписывает иконку в свою форму и срезает до 10% с каждой
        # стороны, поэтому вешалка здесь мельче и фон во весь квадрат.
        ("icon-maskable-512.png", icon(512, rounded=False, glyph=0.84), "RGB"),
        ("apple-touch-icon.png", icon(180, rounded=False, glyph=1.0), "RGB"),
    ]
    for name, im, mode in made:
        if mode == "RGB":
            flat = Image.new("RGB", im.size, GREEN[:3])
            flat.paste(im, mask=im.split()[3])
            im = flat
        im.save(OUT / name)
        print(f"  {name}  {im.size[0]}×{im.size[1]}  {im.mode}")


if __name__ == "__main__":
    main()
