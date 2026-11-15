import { useCallback, useEffect, useState } from 'react';
import { validateStudySet } from '../lib/studySet.js';

const KEY = 'study-assistant:sessions:v1';
const MAX_SESSIONS = 15;

/**
 * Saved study sets in localStorage. Stored data is treated as untrusted too:
 * anything that no longer validates (old version, hand-edited, corrupted) is dropped.
 */
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((s) => {
      try {
        if (typeof s?.id !== 'string' || typeof s?.notes !== 'string') return [];
        const { set } = validateStudySet(s.set);
        return [{ ...s, set }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function useSessions() {
  const [sessions, setSessions] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(sessions));
    } catch {
      // storage full or blocked (private mode): the app still works, it just won't remember
    }
  }, [sessions]);

  const upsert = useCallback((session) => {
    setSessions((list) => [session, ...list.filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS));
  }, []);

  const remove = useCallback((id) => setSessions((list) => list.filter((s) => s.id !== id)), []);

  return { sessions, upsert, remove };
}
