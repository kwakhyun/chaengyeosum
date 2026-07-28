import type { Outing, ParticipantSession, SavedSession } from "./types";

const STORAGE_KEY = "chaengyeosum.sessions.v2";

function loadAll(): SavedSession[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    ) as SavedSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getSavedSessions() {
  return loadAll();
}

export function getSession(outingId: string) {
  return loadAll().find((session) => session.outingId === outingId) ?? null;
}

export function saveSession(session: ParticipantSession, outing: Outing) {
  const next: SavedSession = {
    ...session,
    outingId: outing.id,
    title: outing.title,
    placeName: outing.placeName,
    startsAt: outing.startsAt,
    activityType: outing.activityType,
  };
  const sessions = loadAll().filter(
    (saved) => saved.outingId !== outing.id,
  );
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([next, ...sessions].slice(0, 8)),
  );
}
