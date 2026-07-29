import {
  ChevronRightIcon,
  LightningBoltIcon,
  SunIcon,
} from "@radix-ui/react-icons";

import type { Place } from "../types";

export function PopularSummerPlaces({
  places,
  onCreateOuting,
}: {
  places: Place[];
  onCreateOuting: (place: Place) => void;
}) {
  const waterparks = places.filter(
    (place) => place.category === "waterpark",
  );
  if (waterparks.length === 0) return null;

  return (
    <section
      className="popular-summer-places"
      aria-labelledby="popular-summer-places-title"
    >
      <div className="popular-summer-places__heading">
        <div>
          <p className="eyebrow">WATERPARK PICKS</p>
          <h2 id="popular-summer-places-title">이번 여름, 어디로 갈까?</h2>
        </div>
        <span>
          <SunIcon aria-hidden="true" />
          인기 물놀이
        </span>
      </div>

      <div className="popular-summer-places__track">
        {waterparks.map((place) => {
          const crowd = place.currentCrowd;
          return (
            <article className="popular-summer-place-card" key={place.id}>
              <header>
                <div>
                  <span>워터파크</span>
                  <small>{place.city}</small>
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
                    alt={`${place.name} 물놀이 풍경을 표현한 3D 일러스트`}
                    loading="lazy"
                  />
                </div>
              ) : null}

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
