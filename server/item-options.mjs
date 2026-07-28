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
  { key: "hat", label: "모자", visual: "icon:sun", recommended: false },
  {
    key: "swimwear",
    label: "수영복",
    visual: "icon:backpack",
    recommended: false,
  },
  {
    key: "waterproof-pouch",
    label: "방수팩",
    visual: "icon:mobile",
    recommended: false,
  },
  {
    key: "battery",
    label: "보조배터리",
    visual: "icon:lightning",
    recommended: false,
  },
  {
    key: "camera",
    label: "카메라",
    visual: "icon:camera",
    recommended: false,
  },
  {
    key: "change-clothes",
    label: "여벌옷",
    visual: "icon:layers",
    recommended: false,
  },
  {
    key: "first-aid",
    label: "구급약",
    visual: "icon:heart",
    recommended: false,
  },
  {
    key: "trash-bag",
    label: "쓰레기봉투",
    visual: "icon:trash",
    recommended: false,
  },
  {
    key: "bug-spray",
    label: "벌레기피제",
    visual: "icon:magic-wand",
    recommended: false,
  },
  {
    key: "fan",
    label: "휴대용 선풍기",
    visual: "icon:cool",
    recommended: false,
  },
  {
    key: "speaker",
    label: "블루투스 스피커",
    visual: "icon:speaker",
    recommended: false,
  },
  {
    key: "ticket",
    label: "입장권",
    visual: "icon:tokens",
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
          visual: "icon:custom",
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
