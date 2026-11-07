import { useEffect, useRef, useState, type UIEvent } from "react";

import { formatKoreaTime } from "../time";
import type { Place } from "../types";
import { CrowdPulseVisual } from "./CrowdPulseVisual";

export function CrowdHighlightsCarousel({
  places,
  loading,
}: {
  places: Place[];
  loading: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const livePlaces = places.filter((place) => place.currentCrowd);
  const hasOfficialLive = livePlaces.some(
    (place) => place.currentCrowd?.mode === "live",
  );

  useEffect(() => {
    if (activeIndex >= livePlaces.length) setActiveIndex(0);
  }, [activeIndex, livePlaces.length]);

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
      className="crowd-highlights"
      aria-labelledby="crowd-highlights-title"
    >
      <div className="crowd-highlights__heading">
        <div>
          <p className="eyebrow">HANGANG LIVE</p>
          <h2 id="crowd-highlights-title">지금 한강, 자리 있을까?</h2>
        </div>
        <span className={hasOfficialLive ? "" : "is-estimate"}>
          <i aria-hidden="true" />
          {hasOfficialLive ? "서울 실시간" : "시간대 예상"}
        </span>
      </div>

      {loading && livePlaces.length === 0 ? (
        <div className="crowd-highlights__loading" role="status">
          <span aria-hidden="true" />
          <div>
            <strong>한강 분위기를 읽는 중</strong>
            <small>현재 추정 인구와 덜 붐비는 시간을 확인해요</small>
          </div>
        </div>
      ) : livePlaces.length === 0 ? (
        <div className="highlights-empty" role="status">
          <strong>혼잡 정보를 잠시 불러오지 못했어요</strong>
          <small>잠시 후 다시 열어보면 최신 정보로 보여드릴게요.</small>
        </div>
      ) : (
        <>
          <div
            className="crowd-highlights__track"
            ref={trackRef}
            onScroll={handleScroll}
          >
            {livePlaces.map((place) => {
              const crowd = place.currentCrowd!;
              return (
                <article
                  className={`crowd-highlight-card crowd-highlight-card--${crowd.level}`}
                  key={place.id}
                >
                  <header>
                    <div>
                      <span>
                        {crowd.mode === "live" ? "LIVE" : "예상"}
                      </span>
                      <strong>{place.name}</strong>
                    </div>
                    <small>
                      {formatKoreaTime(crowd.observedAt)} 기준
                    </small>
                  </header>
                  <CrowdPulseVisual
                    crowd={crowd}
                    placeName={place.name}
                    compact
                  />
                  <footer>
                    <div>
                      <small>출발 타이밍</small>
                      <strong>
                        {crowd.timingAdvice?.verdict ??
                          `${crowd.label} 단계예요`}
                      </strong>
                    </div>
                    <span>
                      {crowd.timingAdvice?.peakTime
                        ? `피크 ${formatKoreaTime(crowd.timingAdvice.peakTime)}`
                        : "시간대별 예상"}
                    </span>
                  </footer>
                </article>
              );
            })}
          </div>
          <div
            className="crowd-highlights__pagination"
            aria-label="한강공원 혼잡 정보 선택"
          >
            {livePlaces.map((place, index) => (
              <button
                className={index === activeIndex ? "is-active" : ""}
                type="button"
                aria-label={`${place.name} 보기`}
                aria-current={index === activeIndex ? "true" : undefined}
                key={place.id}
                onClick={() => moveTo(index)}
              />
            ))}
          </div>
          <p className="crowd-highlights__note">
            {hasOfficialLive
              ? "통신사 데이터를 바탕으로 한 서울시 추정 범위예요."
              : "요일·시간·계절을 반영한 참고용 예상치예요."}
          </p>
        </>
      )}
    </section>
  );
}
