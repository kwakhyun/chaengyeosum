import { useEffect, useRef, useState, type UIEvent } from "react";

import type { OutingWeather, RegionalWeather } from "../types";

function weatherVisual(weather: OutingWeather) {
  if (weather.condition === "소나기") {
    return { emoji: "⛈️", mood: "소나기도 추억으로", tone: "storm" };
  }
  if (weather.condition === "비") {
    return { emoji: "🌧️", mood: "우산과 방수팩 챙기기", tone: "rain" };
  }
  if (weather.condition === "구름") {
    return { emoji: "⛅", mood: "구름 그늘 아래 딱 좋아요", tone: "cloud" };
  }
  if (weather.condition === "안개") {
    return { emoji: "🌫️", mood: "천천히 움직이기 좋은 날", tone: "cloud" };
  }
  if (weather.maxTemperature >= 32) {
    return { emoji: "🥵", mood: "얼음물 두 병 각", tone: "hot" };
  }
  if (weather.uvIndex >= 6) {
    return { emoji: "😎", mood: "선크림 덧바를 타이밍", tone: "sunny" };
  }
  return { emoji: "☀️", mood: "밖으로 나가기 좋은 날", tone: "sunny" };
}

export function WeatherHighlightsCarousel({
  regions,
  loading,
}: {
  regions: RegionalWeather[];
  loading: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (activeIndex >= regions.length) setActiveIndex(0);
  }, [activeIndex, regions.length]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const track = event.currentTarget;
    const cards = Array.from(track.children) as HTMLElement[];
    if (cards.length === 0) return;
    const nearest = cards.reduce(
      (selected, card, index) => {
        const distance = Math.abs(card.offsetLeft - track.scrollLeft);
        return distance < selected.distance
          ? { index, distance }
          : selected;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    );
    setActiveIndex(nearest.index);
  };

  const moveTo = (index: number) => {
    const track = trackRef.current;
    const card = track?.children.item(index) as HTMLElement | null;
    if (!track || !card) return;
    track.scrollTo({
      left: card.offsetLeft - track.offsetLeft,
      behavior: "smooth",
    });
    setActiveIndex(index);
  };

  return (
    <section
      className="weather-highlights"
      aria-labelledby="weather-highlights-title"
    >
      <div className="weather-highlights__heading">
        <div>
          <p className="eyebrow">TODAY&apos;S WEATHER</p>
          <h2 id="weather-highlights-title">오늘 어디로 떠날까요?</h2>
        </div>
        <span>지역별 오늘 예보</span>
      </div>

      {loading && regions.length === 0 ? (
        <div className="weather-highlights__loading" role="status">
          <span aria-hidden="true">🌤️</span>
          <div>
            <strong>여름 날씨를 모으는 중</strong>
            <small>서울부터 제주까지 확인하고 있어요</small>
          </div>
        </div>
      ) : (
        <>
          <div
            className="weather-highlights__track"
            ref={trackRef}
            onScroll={handleScroll}
          >
            {regions.map((region) => {
              const visual = weatherVisual(region.weather);
              return (
                <article
                  className={`weather-highlight-card weather-highlight-card--${visual.tone}`}
                  key={region.id}
                >
                  <header>
                    <span>
                      <b>{region.name}</b>
                      <small>{region.spot}</small>
                    </span>
                    <strong>{region.weather.condition}</strong>
                  </header>
                  <div className="weather-highlight-card__body">
                    <span
                      className="weather-highlight-card__emoji"
                      aria-hidden="true"
                    >
                      {visual.emoji}
                    </span>
                    <div>
                      <strong>{region.weather.maxTemperature}°</strong>
                      <span>
                        최저 {region.weather.minTemperature ?? "–"}°
                      </span>
                    </div>
                  </div>
                  <p>{visual.mood}</p>
                  <footer>
                    <span>비 {region.weather.precipitationProbability}%</span>
                    <span>{region.weather.uvLabel}</span>
                  </footer>
                </article>
              );
            })}
          </div>
          <div
            className="weather-highlights__pagination"
            aria-label="지역 날씨 선택"
          >
            {regions.map((region, index) => (
              <button
                className={index === activeIndex ? "is-active" : ""}
                type="button"
                aria-label={`${region.name} 날씨 보기`}
                aria-current={index === activeIndex ? "true" : undefined}
                key={region.id}
                onClick={() => moveTo(index)}
              />
            ))}
          </div>
          <p className="weather-highlights__note">
            오늘 낮 기준 예보예요. 출발 전 최신 정보를 다시 확인해 주세요.
          </p>
        </>
      )}
    </section>
  );
}
