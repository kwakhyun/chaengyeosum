import { useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  Cross2Icon,
  LightningBoltIcon,
  Link2Icon,
  PlusIcon,
  StarFilledIcon,
} from "@radix-ui/react-icons";

import { Sheet } from "./Sheet";
import {
  isSummerTypeKey,
  SUMMER_TYPE_RESULTS,
  type SummerTypeKey,
} from "./SummerTypeTest";

const FRIENDS_STORAGE_KEY = "chaengyeosum.summer-friends.v1";

type FriendType = {
  id: string;
  name: string;
  type: SummerTypeKey;
  addedAt: string;
};

type CrewMember = {
  id: string;
  name: string;
  type: SummerTypeKey;
  isMe: boolean;
};

type CrewResult = {
  name: string;
  score: number;
  catchphrase: string;
  recommendedPlace: string;
  mission: string;
  missingType: SummerTypeKey | null;
};

type CrewStory = Omit<CrewResult, "score" | "missingType">;

const TYPE_ORDER: SummerTypeKey[] = [
  "planner",
  "guardian",
  "vibe",
  "adventurer",
  "foodie",
  "navigator",
  "connector",
  "chill",
];

const CREW_STORIES: Record<string, CrewStory> = {
  planner: {
    name: "체크리스트 평행이론",
    catchphrase: "말하지 않아도 다음 순서를 아는, 정리력으로 통하는 조합이에요.",
    recommendedPlace: "예약형 루프탑 수영장",
    mission: "계획에 없는 간식 하나 현장에서 고르기",
  },
  guardian: {
    name: "과보호 안전 결계단",
    catchphrase: "선크림부터 비상약까지, 서로를 챙기다 가방이 두 배가 돼요.",
    recommendedPlace: "그늘 많은 계곡 쉼터",
    mission: "공용 비상 파우치는 딱 하나만 만들기",
  },
  vibe: {
    name: "셔터 폭주 낭만단",
    catchphrase: "같은 장면을 보고 동시에 카메라를 드는 감성 동기화 조합이에요.",
    recommendedPlace: "노을 한강 피크닉",
    mission: "사진 대신 눈으로만 보는 10분 갖기",
  },
  adventurer: {
    name: "무계획 직진 원정대",
    catchphrase: "목적지보다 출발이 먼저, 변수까지 웃음거리로 만드는 조합이에요.",
    recommendedPlace: "근교 수상 액티비티",
    mission: "출발 전에 필수 준비물 3개만 확인하기",
  },
  foodie: {
    name: "당 충전 미식 원정대",
    catchphrase: "배고플 틈 없이 다음 메뉴가 등장하는 행복한 조합이에요.",
    recommendedPlace: "야시장 푸드 피크닉",
    mission: "각자 처음 보는 여름 간식 하나씩 고르기",
  },
  navigator: {
    name: "길 잃음 제로 안내단",
    catchphrase: "환승도 주차도 그늘길도, 가장 시원한 동선으로 통하는 조합이에요.",
    recommendedPlace: "근교 드라이브 코스",
    mission: "계획에 없던 골목 하나만 탐험하기",
  },
  connector: {
    name: "단톡방 온도 36.5도",
    catchphrase: "누구도 소외되지 않게 말과 마음을 이어주는 다정한 조합이에요.",
    recommendedPlace: "여름 음악 페스티벌",
    mission: "조용한 친구가 고른 코스부터 가보기",
  },
  chill: {
    name: "그늘 명당 휴식단",
    catchphrase: "서두르지 않아도 오래 즐기는 법을 아는 여유 만렙 조합이에요.",
    recommendedPlace: "숲속 계곡 평상",
    mission: "가벼운 액티비티 하나는 꼭 도전하기",
  },
  "foodie+connector": {
    name: "메뉴 합의 만장일치단",
    catchphrase: "모두의 취향을 듣고 가장 맛있는 답을 찾아내는 조합이에요.",
    recommendedPlace: "여름 야시장 투어",
    mission: "친구마다 최애 메뉴를 하나씩 나눠 먹기",
  },
  "navigator+chill": {
    name: "최단거리 여유 여행단",
    catchphrase: "덜 걷는 좋은 길과 제대로 쉬는 타이밍이 만난 조합이에요.",
    recommendedPlace: "그늘 많은 호수 산책로",
    mission: "지도 없이 노을 방향으로 10분 걷기",
  },
  "planner+guardian": {
    name: "철벽 준비 썸머쉴드",
    catchphrase: "비 예보와 준비물 누락도 이 조합 앞에서는 변수가 아니에요.",
    recommendedPlace: "시원한 계곡 피크닉",
    mission: "즉흥 코스 하나는 현장에서 정하기",
  },
  "planner+vibe": {
    name: "기획된 낭만 제작소",
    catchphrase: "시간표와 플레이리스트가 만나 모든 순간을 작품처럼 만들어요.",
    recommendedPlace: "선셋 요트 나들이",
    mission: "서로의 인생샷 콘셉트 하나씩 정하기",
  },
  "planner+adventurer": {
    name: "계획과 즉흥의 황금비",
    catchphrase: "갈 곳은 확실하게, 현장에서는 자유롭게 노는 반전 조합이에요.",
    recommendedPlace: "도심 근교 워터파크",
    mission: "계획에 없는 사진 스폿 하나 찾기",
  },
  "guardian+vibe": {
    name: "날씨도 추억도 맑음",
    catchphrase: "모두가 편안한 순간을 가장 예쁜 장면으로 남기는 조합이에요.",
    recommendedPlace: "서울숲 선셋 피크닉",
    mission: "친구별 인생샷 한 장씩 남기기",
  },
  "guardian+adventurer": {
    name: "브레이크 달린 로켓단",
    catchphrase: "과감하게 출발하되 위험 신호 앞에서는 정확히 멈추는 조합이에요.",
    recommendedPlace: "안전요원 있는 래프팅",
    mission: "탐험 코스와 휴식 시간을 번갈아 정하기",
  },
  "vibe+adventurer": {
    name: "레전드 제조 즉흥단",
    catchphrase: "일단 출발하면 평범한 하루도 공유하고 싶은 추억이 돼요.",
    recommendedPlace: "노을 해변 나들이",
    mission: "출발 전 필수 준비물 3개만 확인하기",
  },
  "planner+guardian+vibe": {
    name: "완벽주의 피크닉 스튜디오",
    catchphrase: "일정과 안전을 챙기면서 결과물까지 예쁘게 남기는 제작진 조합이에요.",
    recommendedPlace: "예약형 한강 피크닉존",
    mission: "한 시간만큼은 계획표 없이 움직이기",
  },
  "planner+guardian+adventurer": {
    name: "안전장치 달린 탐험대",
    catchphrase: "대담한 코스도 준비와 안전망이 있어 마음껏 도전할 수 있어요.",
    recommendedPlace: "숲속 짚라인 원정",
    mission: "각자 도전하고 싶은 코스 하나씩 고르기",
  },
  "planner+vibe+adventurer": {
    name: "콘텐츠 폭발 원정대",
    catchphrase: "큰 틀만 정하면 즉흥과 낭만이 알아서 하이라이트를 만들어요.",
    recommendedPlace: "부산 해변 투어",
    mission: "30초 여름 릴레이 영상 만들기",
  },
  "guardian+vibe+adventurer": {
    name: "센스 만렙 자유여행단",
    catchphrase: "분위기는 자유롭고 서로를 챙기는 감각은 놓치지 않는 조합이에요.",
    recommendedPlace: "제주 바다 드라이브",
    mission: "가장 마음에 드는 장소에서 단체 사진 남기기",
  },
  "planner+guardian+vibe+adventurer": {
    name: "빈틈없는 여름 올스타",
    catchphrase: "계획·안전·추억·즉흥까지, 무슨 일이 생겨도 콘텐츠가 돼요.",
    recommendedPlace: "워터파크 풀코스",
    mission: "각자 시그니처 준비물 하나씩 맡기",
  },
};

function getSavedFriends(): FriendType[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(FRIENDS_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (friend): friend is FriendType =>
          typeof friend?.id === "string" &&
          typeof friend?.name === "string" &&
          isSummerTypeKey(friend?.type) &&
          typeof friend?.addedAt === "string",
      )
      .slice(0, 12);
  } catch {
    return [];
  }
}

function saveFriends(friends: FriendType[]) {
  try {
    window.localStorage.setItem(FRIENDS_STORAGE_KEY, JSON.stringify(friends));
  } catch {
    // 저장 실패가 현재 조합 만들기까지 막지 않게 해요.
  }
}

function parseFriendTypeLink(value: string) {
  try {
    const url = new URL(value.trim(), window.location.origin);
    const type = url.searchParams.get("summerType");
    return isSummerTypeKey(type) ? type : null;
  } catch {
    return null;
  }
}

function hasPair(
  crew: SummerTypeKey[],
  first: SummerTypeKey,
  second: SummerTypeKey,
) {
  return crew.includes(first) && crew.includes(second);
}

function withSubjectParticle(value: string) {
  const lastCode = value.charCodeAt(value.length - 1);
  const hasBatchim =
    lastCode >= 0xac00 &&
    lastCode <= 0xd7a3 &&
    (lastCode - 0xac00) % 28 !== 0;
  return `${value}${hasBatchim ? "이" : "가"}`;
}

function resolveCrew(crew: SummerTypeKey[]): CrewResult {
  const uniqueCrew = TYPE_ORDER.filter((type) => crew.includes(type));
  const complementaryPairs = [
    hasPair(uniqueCrew, "planner", "adventurer"),
    hasPair(uniqueCrew, "guardian", "vibe"),
    hasPair(uniqueCrew, "foodie", "connector"),
    hasPair(uniqueCrew, "navigator", "chill"),
  ].filter(Boolean).length;
  const score = Math.min(
    99,
    70 + crew.length * 4 + uniqueCrew.length * 3 + complementaryPairs * 5,
  );
  const missingType =
    TYPE_ORDER.find((key) => !uniqueCrew.includes(key)) ?? null;
  const pattern = uniqueCrew.join("+");
  const leadType = uniqueCrew[0] ?? "planner";
  const lead = SUMMER_TYPE_RESULTS[leadType];
  const story = CREW_STORIES[pattern] ?? {
    name: `${uniqueCrew
      .map((type) => SUMMER_TYPE_RESULTS[type].shortName)
      .join("·")} 여름 합동단`,
    catchphrase: "서로 다른 준비 재능이 겹치지 않아 예상 밖의 빈틈까지 채우는 조합이에요.",
    recommendedPlace:
      leadType === "foodie"
        ? "여름 야시장 피크닉"
        : leadType === "navigator"
          ? "근교 드라이브 코스"
          : leadType === "connector"
            ? "야외 음악 페스티벌"
            : leadType === "chill"
              ? "그늘 많은 물가 쉼터"
              : "한강 선셋 피크닉",
    mission: `${lead.shortName}의 시그니처 준비물 ‘${lead.signatureItem}’ 함께 써보기`,
  };

  return {
    ...story,
    score,
    missingType,
  };
}

export function SummerCrewBuilder({
  myType,
  sharedType,
  onTrack,
}: {
  myType: SummerTypeKey | null;
  sharedType: SummerTypeKey | null;
  onTrack: (name: string, params?: Record<string, string | number>) => void;
}) {
  const [friends, setFriends] = useState<FriendType[]>(getSavedFriends);
  const [receivedType, setReceivedType] =
    useState<SummerTypeKey | null>(sharedType);
  const members = useMemo<CrewMember[]>(
    () => [
      ...(myType
        ? [{ id: "me", name: "나", type: myType, isMe: true } as CrewMember]
        : []),
      ...friends.map((friend) => ({ ...friend, isMe: false })),
    ],
    [friends, myType],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() => [
    ...(myType ? ["me"] : []),
    ...friends
      .slice(0, myType ? 3 : 4)
      .map((friend) => friend.id),
  ]);
  const [addOpen, setAddOpen] = useState(false);
  const [friendName, setFriendName] = useState("");
  const [friendLink, setFriendLink] = useState("");
  const [addError, setAddError] = useState("");
  const [shareState, setShareState] = useState<
    "idle" | "sharing" | "shared" | "copied"
  >("idle");
  useEffect(() => {
    setSelectedIds((current) => {
      if (!myType) return current.filter((memberId) => memberId !== "me");
      if (current.includes("me")) return current;
      return ["me", ...current].slice(0, 4);
    });
    setShareState("idle");
  }, [myType]);
  const selectedMembers = useMemo(
    () =>
      members
        .filter((member) => selectedIds.includes(member.id))
        .slice(0, 4),
    [members, selectedIds],
  );
  const result = useMemo(
    () => resolveCrew(selectedMembers.map((member) => member.type)),
    [selectedMembers],
  );
  const receivedResult = receivedType
    ? SUMMER_TYPE_RESULTS[receivedType]
    : null;

  const toggleMember = (id: string) => {
    setShareState("idle");
    setSelectedIds((current) => {
      if (current.includes(id)) {
        if (current.length <= 2) return current;
        return current.filter((memberId) => memberId !== id);
      }
      return current.length >= 4 ? current : [...current, id];
    });
    onTrack("summer_crew_member_toggled");
  };

  const openAddFriend = () => {
    setFriendName("");
    setFriendLink("");
    setAddError("");
    setAddOpen(true);
    onTrack("summer_friend_add_opened", {
      source: receivedType ? "shared_result" : "crew_builder",
    });
  };

  const addFriend = () => {
    const name = friendName.trim().replace(/\s+/g, " ").slice(0, 12);
    const type = receivedType ?? parseFriendTypeLink(friendLink);
    if (name.length < 1) {
      setAddError("친구 이름을 입력해 주세요.");
      return;
    }
    if (!type) {
      setAddError("챙겨썸 성향 결과 공유 링크를 확인해 주세요.");
      return;
    }
    const id = `friend_${Date.now().toString(36)}`;
    const friend: FriendType = {
      id,
      name,
      type,
      addedAt: new Date().toISOString(),
    };
    const nextFriends = [friend, ...friends].slice(0, 12);
    setFriends(nextFriends);
    saveFriends(nextFriends);
    setSelectedIds((current) => [
      ...current.slice(0, 3).filter((memberId) => memberId !== id),
      id,
    ]);
    setReceivedType(null);
    setAddOpen(false);
    setShareState("idle");
    onTrack("summer_friend_added", { type });
  };

  const removeFriend = (friendId: string) => {
    const nextFriends = friends.filter((friend) => friend.id !== friendId);
    setFriends(nextFriends);
    saveFriends(nextFriends);
    setSelectedIds((current) =>
      current.filter((memberId) => memberId !== friendId),
    );
    setShareState("idle");
    onTrack("summer_friend_removed");
  };

  const selectAll = () => {
    setSelectedIds(members.slice(0, 4).map((member) => member.id));
    setShareState("idle");
    onTrack("summer_crew_auto_composed", {
      member_count: Math.min(members.length, 4),
    });
  };

  const shareCrew = async () => {
    if (shareState === "sharing" || selectedMembers.length < 2) return;
    setShareState("sharing");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "type");
    url.searchParams.set(
      "crew",
      selectedMembers.map((member) => member.type).join(","),
    );
    url.searchParams.delete("summerType");
    const memberNames = selectedMembers
      .map(
        (member) =>
          `${member.name}(${SUMMER_TYPE_RESULTS[member.type].shortName})`,
      )
      .join(" × ");
    const text = [
      `우리 여름 조합은 ‘${result.name}’`,
      `${memberNames} · 궁합 ${result.score}점`,
      `추천 모임: ${result.recommendedPlace}`,
      "너도 성향 테스트하고 우리 조합에 합류할래?",
    ].join("\n");

    try {
      if (typeof window.navigator.share === "function") {
        await window.navigator.share({
          title: `챙겨썸 | ${result.name}`,
          text,
          url: url.toString(),
        });
        setShareState("shared");
      } else {
        await window.navigator.clipboard.writeText(`${text}\n${url}`);
        setShareState("copied");
      }
      onTrack("summer_crew_shared", {
        crew_size: selectedMembers.length,
        score: result.score,
      });
    } catch {
      setShareState("idle");
    }
  };

  return (
    <>
      <section
        className="summer-crew-builder"
        aria-labelledby="summer-crew-title"
      >
        <header>
          <div>
            <p className="eyebrow">SUMMER CREW</p>
            <h2 id="summer-crew-title">우리 여름 조합은?</h2>
            <span>8가지 실제 친구 유형으로 달라지는 모임 케미를 확인해요.</span>
          </div>
          {members.length > 1 ? (
            <button type="button" onClick={selectAll}>
              <CheckIcon aria-hidden="true" />
              자동 구성
            </button>
          ) : (
            <button type="button" onClick={openAddFriend}>
              <PlusIcon aria-hidden="true" />
              친구 추가
            </button>
          )}
        </header>

        {receivedResult ? (
          <button
            className="summer-friend-received"
            type="button"
            onClick={openAddFriend}
          >
            <img src={receivedResult.image} alt="" draggable={false} />
            <span>
              <small>친구 결과 도착</small>
              <strong>‘{receivedResult.shortName}’ 친구를 저장할까요?</strong>
            </span>
            <PlusIcon aria-hidden="true" />
          </button>
        ) : null}

        {members.length > 0 ? (
          <div className="summer-crew-members" aria-label="실제 친구 유형 선택">
            {members.map((member) => {
              const typeResult = SUMMER_TYPE_RESULTS[member.type];
              const selected = selectedIds.includes(member.id);
              return (
                <article
                  className={`summer-crew-member summer-crew-member--${member.type}${
                    selected ? " is-selected" : ""
                  }`}
                  key={member.id}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleMember(member.id)}
                  >
                    <img src={typeResult.image} alt="" draggable={false} />
                    <span>
                      <strong>{member.name}</strong>
                      <small>
                        {typeResult.shortName} · {typeResult.signatureItem} 담당
                      </small>
                    </span>
                    {selected ? <CheckIcon aria-hidden="true" /> : null}
                  </button>
                  {!member.isMe ? (
                    <button
                      className="summer-crew-member__remove"
                      type="button"
                      aria-label={`${member.name} 친구 결과 삭제`}
                      onClick={() => removeFriend(member.id)}
                    >
                      <Cross2Icon aria-hidden="true" />
                    </button>
                  ) : null}
                </article>
              );
            })}
            <button
              className="summer-crew-member summer-crew-member--add"
              type="button"
              onClick={openAddFriend}
            >
              <PlusIcon aria-hidden="true" />
              <span>
                <strong>친구 결과 추가</strong>
                <small>공유 링크로 등록해요</small>
              </span>
            </button>
          </div>
        ) : (
          <div className="summer-crew-empty">
            <Link2Icon aria-hidden="true" />
            <strong>먼저 내 성향 테스트를 완료해 주세요</strong>
            <span>
              내 결과와 친구가 공유한 결과가 모이면 실제 조합을 만들 수 있어요.
            </span>
          </div>
        )}

        {selectedMembers.length >= 2 ? (
          <article className="summer-crew-result">
            <div className="summer-crew-result__visual" aria-hidden="true">
              {selectedMembers.map((member) => (
                <img
                  src={SUMMER_TYPE_RESULTS[member.type].image}
                  alt=""
                  draggable={false}
                  key={member.id}
                />
              ))}
            </div>
            <div className="summer-crew-result__score">
              <StarFilledIcon aria-hidden="true" />
              <span>
                <small>모임 궁합</small>
                <strong>{result.score}점</strong>
              </span>
            </div>
            <p>
              {selectedMembers.map((member) => member.name).join(" × ")}
            </p>
            <h3>{result.name}</h3>
            <span>{result.catchphrase}</span>

            <dl>
              <div>
                <dt>추천 여름 모임</dt>
                <dd>{result.recommendedPlace}</dd>
              </div>
              <div>
                <dt>오늘의 팀 미션</dt>
                <dd>{result.mission}</dd>
              </div>
            </dl>

            <div className="summer-crew-result__tip">
              <LightningBoltIcon aria-hidden="true" />
              <span>
                <small>
                  {result.missingType ? "한 명 더 부른다면" : "완전체 보너스"}
                </small>
                <strong>
                  {result.missingType
                    ? `${withSubjectParticle(
                        SUMMER_TYPE_RESULTS[result.missingType].shortName,
                      )} 합류하면 더 빈틈없어요`
                    : "모든 역할이 모였어요. 이제 날짜만 잡으면 돼요"}
                </strong>
              </span>
            </div>

            <button
              className="summer-crew-share"
              type="button"
              disabled={shareState === "sharing"}
              onClick={() => void shareCrew()}
            >
              {shareState === "shared" || shareState === "copied" ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
              {shareState === "sharing"
                ? "조합 카드 만드는 중…"
                : shareState === "shared"
                  ? "친구에게 공유했어요"
                  : shareState === "copied"
                    ? "조합 링크를 복사했어요"
                    : "우리 조합 공유하기"}
            </button>
          </article>
        ) : members.length > 0 ? (
          <div className="summer-crew-waiting">
            <span>1 / 2</span>
            <strong>친구 결과가 하나 더 필요해요</strong>
            <button type="button" onClick={openAddFriend}>
              결과 링크로 친구 추가하기
            </button>
          </div>
        ) : null}
      </section>

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="친구 성향 결과 추가"
        description="친구 이름과 챙겨썸 결과 링크를 저장해 조합을 만들어보세요."
      >
        <div className="summer-friend-form">
          {receivedResult ? (
            <div className="summer-friend-form__received">
              <img src={receivedResult.image} alt="" draggable={false} />
              <span>
                <small>받은 결과</small>
                <strong>{receivedResult.name}</strong>
              </span>
            </div>
          ) : null}
          <label>
            <span>친구 이름</span>
            <input
              value={friendName}
              maxLength={12}
              placeholder="예: 민지"
              onChange={(event) => {
                setFriendName(event.target.value);
                setAddError("");
              }}
            />
          </label>
          {!receivedResult ? (
            <label>
              <span>친구가 보낸 결과 링크</span>
              <input
                value={friendLink}
                inputMode="url"
                placeholder="https://.../?summerType=..."
                onChange={(event) => {
                  setFriendLink(event.target.value);
                  setAddError("");
                }}
              />
            </label>
          ) : null}
          {addError ? <p className="form-error">{addError}</p> : null}
          <button
            className="sheet-primary"
            type="button"
            onClick={addFriend}
          >
            친구 결과 저장하기
          </button>
        </div>
      </Sheet>
    </>
  );
}
