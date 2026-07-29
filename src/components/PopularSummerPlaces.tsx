import { useMemo, useState } from "react";
import {
  ChevronRightIcon,
  GlobeIcon,
  LightningBoltIcon,
  ShuffleIcon,
} from "@radix-ui/react-icons";

import type { Place } from "../types";

const CATEGORY_META: Record<
  NonNullable<Place["category"]>,
  { label: string; emoji: string }
> = {
  hangang: { label: "한강", emoji: "🏙️" },
  beach: { label: "해변", emoji: "🏄" },
  waterpark: { label: "워터파크", emoji: "🌊" },
  valley: { label: "계곡", emoji: "🏞️" },
  park: { label: "도심 숲", emoji: "🌳" },
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

function distanceInKilometers(from: Coordinates, to: Coordinates) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function randomRank(id: string, seed: number) {
  let value = seed ^ 0x9e3779b9;
  for (let index = 0; index < id.length; index += 1) {
    value = Math.imul(value ^ id.charCodeAt(index), 2654435761);
  }
  return (value >>> 0) / 4294967295;
}

function formatDistance(distance: number) {
  if (distance < 1) return `${Math.max(100, Math.round(distance * 10) * 100)}m`;
  if (distance < 10) return `${distance.toFixed(1)}km`;
  return `${Math.round(distance)}km`;
}

export function PopularSummerPlaces({
  places,
  onCreateOuting,
  userLocation,
}: {
  places: Place[];
  onCreateOuting: (place: Place) => void;
  userLocation: Coordinates | null;
}) {
  const [randomSeed] = useState(() =>
    Math.floor(Math.random() * 0x7fffffff),
  );
  const summerPlaces = places.filter(
    (place) =>
      place.category !== "hangang" &&
      Boolean(place.tagline && place.summerTip && place.highlights?.length),
  );
  const recommendedPlaces = useMemo(() => {
    return summerPlaces
      .map((place) => ({
        place,
        distance: userLocation
          ? distanceInKilometers(userLocation, place)
          : null,
        random: randomRank(place.id, randomSeed),
      }))
      .sort((left, right) =>
        userLocation
          ? (left.distance ?? 0) - (right.distance ?? 0)
          : left.random - right.random,
      );
  }, [places, randomSeed, userLocation]);
  if (summerPlaces.length === 0) return null;

  return (
    <section
      className="popular-summer-places"
      aria-labelledby="popular-summer-places-title"
    >
      <div className="popular-summer-places__heading">
        <div>
          <p className="eyebrow">SUMMER PICKS</p>
          <h2 id="popular-summer-places-title">여름 모임, 어디서 할까?</h2>
        </div>
        <span>
          {userLocation ? (
            <GlobeIcon aria-hidden="true" />
          ) : (
            <ShuffleIcon aria-hidden="true" />
          )}
          {userLocation ? "가까운 순" : "랜덤 추천"}
        </span>
      </div>

      <div className="popular-summer-places__track">
        {recommendedPlaces.map(({ place, distance }) => {
          const crowd = place.currentCrowd;
          const category = CATEGORY_META[place.category ?? "park"];
          return (
            <article className="popular-summer-place-card" key={place.id}>
              <header>
                <div>
                  <span>{category.label}</span>
                  <small>
                    {place.city}
                    {distance == null
                      ? ""
                      : ` · 내 위치 ${formatDistance(distance)}`}
                  </small>
                </div>
                {crowd ? (
                  <strong
                    className={`popular-summer-place-card__crowd popular-summer-place-card__crowd--${crowd.level}`}
                  >
                    {crowd.label}
                  </strong>
                ) : null}
              </header>

              {place.imageUrl ? (
                <div className="popular-summer-place-card__image">
                  <img
                    src={place.imageUrl}
                    alt={`${place.name}의 여름 풍경을 표현한 3D 일러스트`}
                    loading="lazy"
                  />
                </div>
              ) : (
                <div
                  className={`popular-summer-place-card__image popular-summer-place-card__image--${place.category ?? "park"}`}
                  role="img"
                  aria-label={`${place.name} ${category.label} 일러스트`}
                >
                  <span aria-hidden="true">{category.emoji}</span>
                </div>
              )}

              <h3>{place.name}</h3>
              <p>{place.tagline}</p>

              <div
                className="popular-summer-place-card__highlights"
                aria-label={`${place.name} 특징`}
              >
                {place.highlights?.map((highlight) => (
                  <span key={highlight}>{highlight}</span>
                ))}
              </div>

              <div className="popular-summer-place-card__tip">
                <LightningBoltIcon aria-hidden="true" />
                <span>
                  <small>여름 방문 팁</small>
                  <strong>{place.summerTip}</strong>
                </span>
              </div>

              <button type="button" onClick={() => onCreateOuting(place)}>
                이 장소로 모임 만들기
                <ChevronRightIcon aria-hidden="true" />
              </button>
            </article>
          );
        })}
      </div>
      <p className="popular-summer-places__note">
        혼잡도는 요일·시간·계절을 반영한 참고용 예상치예요. 운영 일정과
        시설은 방문 전 공식 안내를 확인해 주세요.
      </p>
    </section>
  );
}
