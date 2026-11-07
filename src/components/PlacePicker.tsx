import { CheckIcon } from "@radix-ui/react-icons";

import type { Place } from "../types";

const CATEGORY_LABELS: Record<string, string> = {
  hangang: "한강",
  beach: "해변",
  waterpark: "워터파크",
  valley: "계곡",
  park: "도심 숲",
};

const CATEGORY_ARTWORK: Record<string, string> = {
  hangang: "/assets/hero-picnic.png",
  beach: "/assets/summer-place-songjeong-v1.webp",
  waterpark: "/assets/waterpark-caribbean-bay-v1.webp",
  valley: "/assets/summer-place-baegun-valley-v1.webp",
  park: "/assets/summer-place-seoul-forest-v1.webp",
};

export function placeArtwork(
  imageUrl: string | null | undefined,
  category: string | null | undefined,
) {
  return (
    imageUrl ??
    (category ? CATEGORY_ARTWORK[category] : undefined) ??
    "/assets/hero-picnic.png"
  );
}

export function placeCategoryLabel(category: string | null | undefined) {
  return category ? (CATEGORY_LABELS[category] ?? "") : "";
}

export function waterActivityForCategory(category: string | null | undefined) {
  return ["waterpark", "beach", "valley"].includes(category ?? "");
}

function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

/**
 * 추천 장소를 이미지 카드 목록으로 골라요. 위치를 허용했다면 가까운 순으로 보여줘요.
 */
export function PlacePicker({
  places,
  value,
  onChange,
  userLocation,
  label,
}: {
  places: Place[];
  value: string;
  onChange: (place: Place) => void;
  userLocation?: { latitude: number; longitude: number } | null;
  /** fieldset 바깥에서 쓸 때만 그룹 이름을 따로 붙여요. */
  label?: string;
}) {
  const sorted = userLocation
    ? [...places]
        .map((place) => ({ place, distance: distanceKm(userLocation, place) }))
        .sort((left, right) => left.distance - right.distance)
    : places.map((place) => ({ place, distance: null as number | null }));

  if (places.length === 0) {
    return <p className="place-picker__loading">장소 목록을 불러오고 있어요…</p>;
  }

  return (
    <div className="place-card-picker" role="group" aria-label={label}>
      {sorted.map(({ place, distance }) => {
        const selected = place.id === value;
        const categoryLabel = placeCategoryLabel(place.category);
        return (
          <button
            className={`place-card-option${selected ? " is-selected" : ""}`}
            type="button"
            aria-pressed={selected}
            key={place.id}
            onClick={() => onChange(place)}
          >
            <img
              src={placeArtwork(place.imageUrl, place.category)}
              alt=""
              loading="lazy"
              draggable={false}
            />
            <span className="place-card-option__copy">
              <strong>{place.name}</strong>
              <small>
                {[
                  categoryLabel,
                  place.city,
                  distance != null ? `${Math.round(distance)}km` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              {place.currentCrowd ? (
                <em
                  className={`place-card-option__crowd place-card-option__crowd--${place.currentCrowd.level}`}
                >
                  지금 {place.currentCrowd.label}
                </em>
              ) : null}
            </span>
            <span className="place-card-option__check" aria-hidden="true">
              {selected ? <CheckIcon /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
