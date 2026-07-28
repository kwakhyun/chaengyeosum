export const PLACES = [
  {
    id: "yeouido-hangang",
    name: "여의도 한강공원",
    latitude: 37.5283,
    longitude: 126.9344,
    city: "서울",
    crowdBaseline: 58,
    seoulCrowdArea: "여의도한강공원",
  },
  {
    id: "banpo-hangang",
    name: "반포 한강공원",
    latitude: 37.5105,
    longitude: 126.995,
    city: "서울",
    crowdBaseline: 62,
    seoulCrowdArea: "반포한강공원",
  },
  {
    id: "ttukseom-hangang",
    name: "뚝섬 한강공원",
    latitude: 37.5293,
    longitude: 127.0731,
    city: "서울",
    crowdBaseline: 61,
    seoulCrowdArea: "뚝섬한강공원",
  },
  {
    id: "nanji-hangang",
    name: "난지 한강공원",
    latitude: 37.5668,
    longitude: 126.8766,
    city: "서울",
    crowdBaseline: 48,
    seoulCrowdArea: "난지한강공원",
  },
  {
    id: "gwangalli",
    name: "광안리 해수욕장",
    latitude: 35.1532,
    longitude: 129.1187,
    city: "부산",
    crowdBaseline: 65,
  },
  {
    id: "eulwangri",
    name: "을왕리 해수욕장",
    latitude: 37.4477,
    longitude: 126.3724,
    city: "인천",
    crowdBaseline: 57,
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
