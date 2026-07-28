export const ITEM_OPTIONS = [
  {
    key: "towel",
    label: "쿨타월",
    visual: "asset:item-towel.png",
    recommended: true,
  },
  {
    key: "mat",
    label: "돗자리",
    visual: "asset:item-mat.png",
    recommended: true,
  },
  {
    key: "water",
    label: "얼음물",
    visual: "asset:item-water.png",
    recommended: true,
  },
  {
    key: "umbrella",
    label: "우산",
    visual: "asset:item-umbrella.png",
    recommended: true,
  },
  {
    key: "sunscreen",
    label: "선크림",
    visual: "asset:item-sunscreen.png",
    recommended: true,
  },
  {
    key: "snack",
    label: "간식",
    visual: "asset:item-snack.png",
    recommended: true,
  },
  {
    key: "hat",
    label: "모자",
    visual: "asset:item-hat-3d.png",
    recommended: false,
  },
  {
    key: "swimwear",
    label: "수영복",
    visual: "asset:item-swimwear-3d.png",
    recommended: false,
  },
  {
    key: "waterproof-pouch",
    label: "방수팩",
    visual: "asset:item-waterproof-pouch-3d.png",
    recommended: false,
  },
  {
    key: "battery",
    label: "보조배터리",
    visual: "asset:item-battery-3d.png",
    recommended: false,
  },
  {
    key: "camera",
    label: "카메라",
    visual: "asset:item-camera-3d.png",
    recommended: false,
  },
  {
    key: "change-clothes",
    label: "여벌옷",
    visual: "asset:item-change-clothes-3d.png",
    recommended: false,
  },
  {
    key: "first-aid",
    label: "구급약",
    visual: "asset:item-first-aid-3d.png",
    recommended: false,
  },
  {
    key: "trash-bag",
    label: "쓰레기봉투",
    visual: "asset:item-trash-bag-3d.png",
    recommended: false,
  },
  {
    key: "bug-spray",
    label: "벌레기피제",
    visual: "asset:item-bug-spray-3d.png",
    recommended: false,
  },
  {
    key: "fan",
    label: "휴대용 선풍기",
    visual: "asset:item-fan-3d.png",
    recommended: false,
  },
  {
    key: "speaker",
    label: "블루투스 스피커",
    visual: "asset:item-speaker-3d.png",
    recommended: false,
  },
  {
    key: "ticket",
    label: "입장권",
    visual: "asset:item-ticket-3d.png",
    recommended: false,
  },
];

export const MAX_ITEMS = 15;

export function getItemOption(key) {
  return ITEM_OPTIONS.find((option) => option.key === key) ?? null;
}

export function resolveItemSelection(itemKeys, customItems) {
  const requestedKeys = Array.isArray(itemKeys)
    ? itemKeys
    : ITEM_OPTIONS.filter((option) => option.recommended).map(
        (option) => option.key,
      );
  const uniqueKeys = [...new Set(requestedKeys)].slice(0, MAX_ITEMS);
  const selected = uniqueKeys
    .map(getItemOption)
    .filter((option) => option != null);

  const custom = Array.isArray(customItems)
    ? [...new Set(customItems.map(normalizeCustomLabel).filter(Boolean))]
        .slice(0, MAX_ITEMS - selected.length)
        .map((label) => ({
          key: null,
          label,
          visual: "asset:item-custom-3d.png",
          recommended: false,
        }))
    : [];

  return [...selected, ...custom].slice(0, MAX_ITEMS);
}

export function normalizeCustomLabel(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 16)
    : "";
}
