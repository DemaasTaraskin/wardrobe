"""Рисует иконки приложения: python tools/make_icons.py

Вешалка описана числами в HANGERS и собирается из трёх линий: плечики,
перекладина и крюк. Крюк сидит по центру над вершиной, а стойка приходит к
нему S-образным изгибом — так рисуют вешалку Tabler, Phosphor и Material, и
так она читается вешалкой, а не треугольником с крючком.

Пропорции настоящей вешалки: 41–45 см в ширину при 19–22 см общей высоты,
крюк добавляет 8–10 см над плечом. То есть ширина к высоте примерно 2:1.

Что на выходе (docs/icons/, к имени добавляется V):
  icon-192-N.png, icon-512-N.png   — скруглённый квадрат, углы прозрачные
  icon-maskable-512-N.png          — во весь квадрат: Android режет иконку сам
  apple-touch-icon-N.png           — во весь квадрат: iOS тоже режет сам

Нужен только Pillow.

Меняешь рисунок — поднимай V и правь ссылки в index.html, manifest.webmanifest
и sw.js. iOS кэширует иконку по адресу и отдаёт старую картинку даже после
удаления ярлыка с домашнего экрана; новое имя файла — единственный способ,
который работает наверняка.
"""

from __future__ import annotations

import math
import pathlib
import sys
from dataclasses import dataclass

from PIL import Image, ImageDraw

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

OUT = pathlib.Path(__file__).resolve().parents[1] / "docs" / "icons"
V = "3"                         # версия рисунка, она же хвост в имени файла
CHOSEN = "mid"                  # какая вешалка из HANGERS идёт в иконки
# Цвета — по образцу иконки ChatGPT: чёрный знак на светлой подложке.
BG = (237, 235, 231, 255)       # светло-серый
FG = (13, 13, 13, 255)          # чёрный
SS = 4                          # сглаживание: рисуем вчетверо крупнее и ужимаем


# ---------------------------------------------------------------- вешалка

@dataclass(frozen=True)
class Hanger:
    """Вешалка в долях ширины перекладины: её принимаем за 1."""
    rise: float      # насколько вершина плечиков выше перекладины
    neck: float      # прямая часть стойки от вершины до петли
    hook_r: float    # радиус петли крюка
    stroke: float    # толщина линии
    tip: float = 40  # на сколько градусов кончик крюка загнут внутрь


# Крюк у всех один: петля заметно крупнее толщины линии, кончик загнут на 20°.
# Туже — просвет закрывается и крюк читается спиралью, шире — перестаёт быть крюком.
HANGERS = {
    # Пропорции настоящей вешалки: широкая и низкая, 1.8:1
    "real": Hanger(rise=0.215, neck=0.095, hook_r=0.115, stroke=0.082, tip=20),
    # Средняя: плечики круче, вешалка компактнее, 1.5:1
    "mid": Hanger(rise=0.300, neck=0.095, hook_r=0.115, stroke=0.085, tip=20),
    # Как было: плечики почти в половину ширины, 1.3:1
    "tall": Hanger(rise=0.388, neck=0.100, hook_r=0.120, stroke=0.090, tip=20),
}


def bezier(p0, p1, p2, p3, steps=40):
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
    return out


def paths(h: Hanger) -> list[list[tuple[float, float]]]:
    """Три линии в координатах, где вершина плечиков — (0, 0), а y растёт вниз."""
    half = 0.5
    shoulders = [(-half, h.rise), (0.0, 0.0), (half, h.rise)]
    bar = [(-half, h.rise), (half, h.rise)]

    cy = -(h.neck + h.hook_r)                      # центр петли — ровно над вершиной
    left = (-h.hook_r, cy)
    # Стойка выходит из вершины вверх и вертикально же входит в петлю слева:
    # обе касательные вертикальны, поэтому стыка не видно.
    span = h.neck + h.hook_r
    neck = bezier((0.0, 0.0), (0.0, -span * 0.62), (-h.hook_r, cy + h.hook_r * 0.72), left)

    hook = list(neck)
    for deg in range(180, -h.tip - 1, -3):         # петля через верх и загиб кончика
        t = math.radians(deg)
        hook.append((h.hook_r * math.cos(t), cy - h.hook_r * math.sin(t)))
    return [shoulders, bar, hook]


def bounds(h: Hanger) -> tuple[float, float, float, float]:
    pts = [p for path in paths(h) for p in path]
    r = h.stroke / 2
    return (min(x for x, _ in pts) - r, min(y for _, y in pts) - r,
            max(x for x, _ in pts) + r, max(y for _, y in pts) + r)


def densify(pts, step):
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / step))
        out += [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(n + 1)]
    return out


def draw_hanger(d: ImageDraw.ImageDraw, size: int, h: Hanger, fill: float) -> None:
    """Вписывает вешалку в квадрат size×size так, чтобы она заняла долю fill по ширине.

    Линия — это след круглой кисти: ставим кружок через каждые полпикселя.
    `ImageDraw.line(joint="curve")` на крутой дуге оставляет щели по внешнему
    краю, и крюк выходит мохнатым.
    """
    x0, y0, x1, y1 = bounds(h)
    k = size * fill / (x1 - x0)
    ox = size / 2 - (x0 + x1) / 2 * k              # по ширине вешалка симметрична
    oy = size / 2 - (y0 + y1) / 2 * k
    r = max(1.0, h.stroke * k / 2)

    for path in paths(h):
        pts = [(ox + x * k, oy + y * k) for x, y in path]
        for x, y in densify(pts, 0.5):
            d.ellipse((x - r, y - r, x + r, y + r), fill=FG)


# ---------------------------------------------------------------- иконки

def icon(size: int, *, rounded: bool, fill: float, hanger: str = CHOSEN) -> Image.Image:
    big = size * SS
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.2237), fill=BG)
    else:
        d.rectangle((0, 0, big - 1, big - 1), fill=BG)
    draw_hanger(d, big, HANGERS[hanger], fill)
    return im.resize((size, size), Image.LANCZOS)


def flatten(im: Image.Image) -> Image.Image:
    flat = Image.new("RGB", im.size, BG[:3])
    flat.paste(im, mask=im.split()[3])
    return flat


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    made = [
        (f"icon-192-{V}.png", icon(192, rounded=True, fill=0.66), False),
        (f"icon-512-{V}.png", icon(512, rounded=True, fill=0.66), False),
        # Android вписывает иконку в свою форму и срезает до 10% с каждой
        # стороны, поэтому вешалка здесь мельче и фон во весь квадрат.
        (f"icon-maskable-512-{V}.png", icon(512, rounded=False, fill=0.56), True),
        (f"apple-touch-icon-{V}.png", icon(180, rounded=False, fill=0.66), True),
    ]
    for name, im, flat in made:
        if flat:
            im = flatten(im)
        im.save(OUT / name)
        print(f"  {name}  {im.size[0]}×{im.size[1]}  {im.mode}")


if __name__ == "__main__":
    main()
