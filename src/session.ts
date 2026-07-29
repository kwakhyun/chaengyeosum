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

export function mergeSessions(recovered: SavedSession[]) {
  const current = loadAll();
  const recoveredIds = new Set(recovered.map((session) => session.outingId));
  const merged = [
    ...recovered,
    ...current.filter((session) => !recoveredIds.has(session.outingId)),
  ].slice(0, 20);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function replaceSessions(recovered: SavedSession[]) {
  const next = recovered.slice(0, 20);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
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
    JSON.stringify([next, ...sessions].slice(0, 20)),
  );
}

export function removeSession(outingId: string) {
  const sessions = loadAll().filter(
    (session) => session.outingId !== outingId,
  );
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}
