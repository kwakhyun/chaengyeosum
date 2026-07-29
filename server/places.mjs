export const PLACES = [
  {
    id: "yeouido-hangang",
    name: "여의도 한강공원",
    latitude: 37.5283,
    longitude: 126.9344,
    city: "서울",
    crowdBaseline: 58,
    seoulCrowdArea: "여의도한강공원",
    category: "hangang",
  },
  {
    id: "banpo-hangang",
    name: "반포 한강공원",
    latitude: 37.5105,
    longitude: 126.995,
    city: "서울",
    crowdBaseline: 62,
    seoulCrowdArea: "반포한강공원",
    category: "hangang",
  },
  {
    id: "ttukseom-hangang",
    name: "뚝섬 한강공원",
    latitude: 37.5293,
    longitude: 127.0731,
    city: "서울",
    crowdBaseline: 61,
    seoulCrowdArea: "뚝섬한강공원",
    category: "hangang",
  },
  {
    id: "nanji-hangang",
    name: "난지 한강공원",
    latitude: 37.5668,
    longitude: 126.8766,
    city: "서울",
    crowdBaseline: 48,
    seoulCrowdArea: "난지한강공원",
    category: "hangang",
  },
  {
    id: "gwangalli",
    name: "광안리 해수욕장",
    latitude: 35.1532,
    longitude: 129.1187,
    city: "부산",
    crowdBaseline: 65,
    category: "beach",
  },
  {
    id: "eulwangri",
    name: "을왕리 해수욕장",
    latitude: 37.4477,
    longitude: 126.3724,
    city: "인천",
    crowdBaseline: 57,
    category: "beach",
  },
  {
    id: "songjeong-beach",
    name: "송정해수욕장",
    latitude: 35.1786,
    longitude: 129.1997,
    city: "부산",
    crowdBaseline: 61,
    category: "beach",
    tagline: "바다 산책과 서핑 체험을 함께 즐기기 좋은 부산 동부 해변",
    highlights: ["완만한 해변", "서핑 체험", "일출·노을"],
    summerTip: "물놀이 구역과 기상 상황을 확인하고 해 질 무렵 산책도 즐겨보세요.",
    imageUrl: "/assets/summer-place-songjeong-v1.webp",
    officialUrl:
      "https://visitbusan.net/index.do?contentsSid=22&lang_cd=ko&uc_seq=280",
  },
  {
    id: "baegun-valley",
    name: "포천 백운계곡",
    latitude: 38.0748,
    longitude: 127.4143,
    city: "경기 포천",
    crowdBaseline: 56,
    category: "valley",
    tagline: "울창한 숲과 시원한 물길에서 쉬어가는 수도권 계곡 나들이",
    highlights: ["계곡 물놀이", "숲 그늘", "드라이브"],
    summerTip: "비 온 뒤에는 수위와 출입 가능 구간을 공식 안내에서 확인해요.",
    imageUrl: "/assets/summer-place-baegun-valley-v1.webp",
    officialUrl:
      "https://www.pocheon.go.kr/ktour/viewTursmResrceWeb.do?cpn=62&firstIndex=610&key=9750&lastIndex=620&resrceNo=191&sc1=ktour",
  },
  {
    id: "seoul-forest",
    name: "서울숲",
    latitude: 37.5444,
    longitude: 127.0374,
    city: "서울 성수",
    crowdBaseline: 54,
    category: "park",
    tagline: "그늘 산책과 피크닉 뒤 성수동 코스까지 이어지는 도심 숲",
    highlights: ["피크닉", "호수 산책", "성수동 코스"],
    summerTip: "한낮을 피해 늦은 오후에 만나고 대중교통을 이용하면 편해요.",
    imageUrl: "/assets/summer-place-seoul-forest-v1.webp",
    officialUrl: "https://parks.seoul.go.kr/template/sub/seoulforest.do",
  },
  {
    id: "caribbean-bay",
    name: "캐리비안 베이",
    latitude: 37.2931,
    longitude: 127.2026,
    city: "경기 용인",
    crowdBaseline: 67,
    category: "waterpark",
    tagline: "파도풀과 스릴 어트랙션을 함께 즐기는 수도권 워터파크",
    highlights: ["대형 파도풀", "스릴 슬라이드", "친구·커플"],
    summerTip: "인기 시설을 먼저 즐기려면 개장 직후 입장을 추천해요.",
    imageUrl: "/assets/waterpark-caribbean-bay-v1.webp",
    officialUrl:
      "https://reservation.everland.com/web/cb.do?method=productMain",
  },
  {
    id: "ocean-world",
    name: "오션월드",
    latitude: 37.6457,
    longitude: 127.681,
    city: "강원 홍천",
    crowdBaseline: 66,
    category: "waterpark",
    tagline: "서핑마운트와 익스트림리버로 유명한 리조트형 워터파크",
    highlights: ["서핑마운트", "익스트림리버", "리조트 여행"],
    summerTip: "주말에는 오전 입장 후 인기 어트랙션부터 즐겨보세요.",
    imageUrl: "/assets/waterpark-ocean-world-v1.webp",
    officialUrl: "https://www.sonohotelsresorts.com/complex_vp/guidemap",
  },
  {
    id: "gimhae-lotte-waterpark",
    name: "김해 롯데워터파크",
    latitude: 35.1787,
    longitude: 128.8275,
    city: "경남 김해",
    crowdBaseline: 64,
    category: "waterpark",
    tagline: "실내·실외 파도풀과 대형 슬라이드를 갖춘 남부권 워터파크",
    highlights: ["자이언트 웨이브", "실내 물놀이", "가족 여행"],
    summerTip: "실내와 실외 운영 시설을 방문 전 공식 안내에서 확인해요.",
    imageUrl: "/assets/waterpark-gimhae-v1.webp",
    officialUrl: "https://www.lotteworld.com/waterpark/index.asp",
  },
];

export function getPlace(placeId) {
  return PLACES.find((place) => place.id === placeId) ?? null;
}

export function getCustomPlace(value) {
  const name =
    typeof value?.name === "string"
      ? value.name.trim().replace(/\s+/g, " ").slice(0, 40)
      : "";
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (
    name.length < 2 ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < 32 ||
    latitude > 39 ||
    longitude < 124 ||
    longitude > 132
  ) {
    return null;
  }
  return {
    id: `custom:${latitude.toFixed(5)}:${longitude.toFixed(5)}`,
    name,
    latitude,
    longitude,
    city: name.split(",").at(-1)?.trim().slice(0, 20) || "대한민국",
    crowdBaseline: 45,
  };
}

export async function searchPlaces(query, fetchImpl = fetch) {
  const keyword =
    typeof query === "string"
      ? query.trim().replace(/\s+/g, " ").slice(0, 40)
      : "";
  if (keyword.length < 2) return [];

  const params = new URLSearchParams({
    name: keyword,
    count: "6",
    language: "ko",
    format: "json",
    countryCode: "KR",
  });
  try {
    const response = await fetchImpl(
      `https://geocoding-api.open-meteo.com/v1/search?${params}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!response.ok) return [];
    const payload = await response.json();
    return (Array.isArray(payload.results) ? payload.results : [])
      .map((result) =>
        getCustomPlace({
          name: [
            result.name,
            result.admin2,
            result.admin1,
          ]
            .filter(Boolean)
            .filter((value, index, values) => values.indexOf(value) === index)
            .join(", "),
          latitude: result.latitude,
          longitude: result.longitude,
        }),
      )
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    return [];
  }
}
