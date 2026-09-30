// Двухуровневый справочник вещей.
//   Раздел 1 уровня — куртки · верх · низ · обувь · аксессуары.
//   Раздел 2 уровня — то, что хранится у вещи в поле subcategory.
// Раздел 1 уровня в базе не хранится: он выводится отсюда по подразделу.
// Слоты (база, 2-й слой, верх, низ, обувь, аксессуар) — отдельное измерение:
// это роль вещи в луке, а не её тип. Они живут в lib.js.
//
// Переименовать раздел или подраздел можно прямо здесь: в базе лежат id,
// на экране показываются label. Менять id — только вместе с пересчётом вещей.

export const SECTIONS = [
  {
    id: 'top',
    label: 'Верх',
    subs: [
      { id: 'tshirt', label: 'Футболки' },
      { id: 'tank', label: 'Майки' },
      { id: 'longsleeve', label: 'Лонгсливы' },
      { id: 'polo', label: 'Поло' },
      { id: 'shirt', label: 'Рубашки' },
      { id: 'overshirt', label: 'Плотные рубашки' },
      { id: 'sweater', label: 'Джемперы и флис' },
      { id: 'sweatshirt', label: 'Свитшоты' },
      { id: 'hoodie', label: 'Худи' },
      { id: 'vest', label: 'Безрукавки' },
      { id: 'blazer', label: 'Пиджаки' },
    ],
  },
  {
    id: 'outerwear',
    label: 'Куртки',
    subs: [
      { id: 'bomber', label: 'Бомберы' },
      { id: 'jacket', label: 'Куртки' },
      { id: 'raincoat', label: 'Плащи и ветровки' },
      { id: 'coat', label: 'Пальто' },
      { id: 'puffer', label: 'Пуховики' },
    ],
  },
  {
    id: 'bottom',
    label: 'Низ',
    subs: [
      { id: 'jeans', label: 'Джинсы' },
      { id: 'trousers', label: 'Брюки' },
      { id: 'shorts', label: 'Шорты' },
      { id: 'sweatpants', label: 'Спортивные штаны' },
    ],
  },
  {
    id: 'shoes',
    label: 'Обувь',
    subs: [
      { id: 'sneakers', label: 'Кроссовки' },
      { id: 'boots', label: 'Ботинки' },
      { id: 'dress_shoes', label: 'Туфли и лоферы' },
      { id: 'slides', label: 'Сабо и шлёпанцы' },
    ],
  },
  {
    id: 'accessories',
    label: 'Аксессуары',
    subs: [
      { id: 'bag', label: 'Сумки' },
      { id: 'cap', label: 'Кепки' },
      { id: 'hat', label: 'Шапки и снуды' },
      { id: 'gloves', label: 'Перчатки' },
      { id: 'belt', label: 'Ремни' },
      { id: 'scarf', label: 'Шарфы' },
    ],
  },
];

/** Плоский список подразделов с ссылкой на свой раздел 1 уровня. */
export const SUBS = SECTIONS.flatMap((s) => s.subs.map((sub) => ({ ...sub, section: s.id, sectionLabel: s.label })));

const SUB_BY_ID = new Map(SUBS.map((s) => [s.id, s]));

export const subInfo = (id) => SUB_BY_ID.get(id) || null;
export const subLabel = (id) => (SUB_BY_ID.get(id) || {}).label || 'Без раздела';
export const sectionOf = (subId) => (SUB_BY_ID.get(subId) || {}).section || null;
export const sectionLabel = (sectionId) => (SECTIONS.find((s) => s.id === sectionId) || {}).label || '';

/** Подраздел по умолчанию для старой категории — на случай вещи без subcategory. */
export const SUB_BY_CATEGORY = {
  tshirt: 'tshirt', longsleeve: 'longsleeve', polo: 'polo', shirt: 'shirt',
  sweater: 'sweater', sweatshirt: 'sweatshirt', hoodie: 'hoodie', vest: 'vest',
  blazer: 'blazer', jacket: 'jacket', coat: 'coat', suit: 'blazer',
  jeans: 'jeans', trousers: 'trousers', shorts: 'shorts', sweatpants: 'sweatpants',
  shoes: 'sneakers', accessory: 'bag',
};

export const subOfItem = (item) => item.subcategory || SUB_BY_CATEGORY[item.category] || null;

/** Обратное соответствие: по подразделу восстанавливается категория из DATA.md.
 *  На категории держатся правила сборки луков, поэтому она едет за подразделом сама
 *  и отдельным полем в карточке не показывается. */
export const CATEGORY_BY_SUB = {
  tshirt: 'tshirt', tank: 'tshirt', longsleeve: 'longsleeve', polo: 'polo',
  shirt: 'shirt', overshirt: 'shirt', sweater: 'sweater', sweatshirt: 'sweatshirt',
  hoodie: 'hoodie', vest: 'vest', blazer: 'blazer',
  bomber: 'jacket', jacket: 'jacket', raincoat: 'jacket', puffer: 'jacket', coat: 'coat',
  jeans: 'jeans', trousers: 'trousers', shorts: 'shorts', sweatpants: 'sweatpants',
  sneakers: 'shoes', boots: 'shoes', dress_shoes: 'shoes', slides: 'shoes',
  bag: 'accessory', cap: 'accessory', hat: 'accessory', gloves: 'accessory',
  belt: 'accessory', scarf: 'accessory',
};

export const SEASONS = [
  { id: 'summer', label: 'Лето' },
  { id: 'demi', label: 'Осень-весна' },
  { id: 'winter', label: 'Зима' },
];
