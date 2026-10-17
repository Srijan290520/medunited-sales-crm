// cache.ts — the last copy of server data, so pages can draw at once.
//
// Apps Script answers in 2–30 s, so pages show what this tab loaded last and
// refresh it in the background. Kept in sessionStorage (this tab only, gone
// when it closes, like the login) and wiped on login, logout and an expired
// session, so one person's data is never shown to the next. It only holds
// what the server already sent this user; the server still filters by role.

import type { ApiResponse } from './api';

const PREFIX = 'mu_cache:';
const memory = new Map<string, unknown>(); // when storage is blocked or full
const inflight = new Map<string, Promise<ApiResponse>>();
let epoch = 0; // goes up whenever data changes on the server

export function peek<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    /* storage blocked: fall back to memory */
  }
  return memory.get(key) as T | undefined;
}

export function put(key: string, value: unknown) {
  memory.set(key, value);
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* full or blocked: the memory copy still serves this page visit */
  }
}

// Drops every key starting with `prefix` ('' = everything).
export function invalidate(prefix = '') {
  for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k);
  for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k);
  try {
    // Collect first: removing while walking the list can reorder it and skip keys.
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* storage blocked */
  }
}

export const clearCache = () => {
  epoch++;
  invalidate('');
};

// Something changed on the server. Answers already on their way may predate
// it: they still reach the page that asked, but aren't kept as the last copy,
// and the next request goes out fresh. Kept copies stay (they're redrawn and
// then refreshed, which is the point).
export function markStale() {
  epoch++;
  inflight.clear();
}

// One request at a time per key: a page asking while the background load is
// still on its way waits for that answer instead of sending its own.
export function shared(key: string, fetcher: () => Promise<ApiResponse>): Promise<ApiResponse> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const p: Promise<ApiResponse> = fetcher().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key); // a newer request may have replaced it
  });
  inflight.set(key, p);
  return p;
}

// Fresh from the server every time; a good answer becomes the new last copy.
export function refresh(key: string, fetcher: () => Promise<ApiResponse>): Promise<ApiResponse> {
  return shared(key, async () => {
    const started = epoch;
    const res = await fetcher();
    if (!res.error && started === epoch) put(key, res);
    return res;
  });
}

// Data that rarely changes (dropdown lists, users, prices, modules): fetched
// once per login. The calls that change it clear it (see api.ts).
export function once(key: string, fetcher: () => Promise<ApiResponse>): Promise<ApiResponse> {
  const hit = peek<ApiResponse>(key);
  return hit ? Promise.resolve(hit) : refresh(key, fetcher);
}
