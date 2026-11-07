// 한국어 조사를 단어의 마지막 글자 받침에 맞춰 붙여요.
const DIGIT_HAS_FINAL_CONSONANT: Record<string, boolean> = {
  "0": true,
  "1": true,
  "2": false,
  "3": true,
  "4": false,
  "5": false,
  "6": true,
  "7": true,
  "8": true,
  "9": false,
};

export function hasFinalConsonant(word: string) {
  const trimmed = word.trim().replace(/[\s)"'’”\]]+$/u, "");
  const last = trimmed.at(-1) ?? "";
  if (last in DIGIT_HAS_FINAL_CONSONANT) {
    return DIGIT_HAS_FINAL_CONSONANT[last];
  }
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 !== 0;
  }
  return false;
}

/** 을/를 */
export function withObject(word: string) {
  return `${word}${hasFinalConsonant(word) ? "을" : "를"}`;
}

/** 은/는 */
export function withTopic(word: string) {
  return `${word}${hasFinalConsonant(word) ? "은" : "는"}`;
}

/** 이/가 */
export function withSubject(word: string) {
  return `${word}${hasFinalConsonant(word) ? "이" : "가"}`;
}
