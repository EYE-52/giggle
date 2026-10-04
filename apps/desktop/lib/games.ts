"use client";

import { useSyncExternalStore } from "react";
import { api } from "@giggle/core";

/**
 * Whether squad games are on, as the API says (`games` in GET /api/features,
 * true only when the bridge is correctly configured server-side). Mirrors
 * lib/discovery.ts: unknown until the first answer arrives; the last answer
 * is remembered per browser so a reload does not flash the entry in or out.
 */
type GamesState = boolean | null;

const CACHE_KEY = "giggle.games";
let state: GamesState = null;
let loading = false;
let loaded = false;
const listeners = new Set<() => void>();

function readCache(): GamesState {
  try {
    const value = localStorage.getItem(CACHE_KEY);
    return value === "on" ? true : value === "off" ? false : null;
  } catch {
    return null;
  }
}

function set(next: boolean) {
  loaded = true;
  try { localStorage.setItem(CACHE_KEY, next ? "on" : "off"); } catch {}
  if (state === next) return;
  state = next;
  listeners.forEach(listener => listener());
}

function load(refresh = false) {
  if (loading || (!refresh && loaded) || typeof window === "undefined") return;
  if (state === null) state = readCache();
  loading = true;
  api.getFeatures()
    .then(features => set(!!features.games))
    .catch(() => {})
    .finally(() => { loading = false; });
}

function refreshOnFocus() { load(true); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("focus", refreshOnFocus);
  load();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("focus", refreshOnFocus);
  };
}

/** true / false once known; null while the first answer is on its way. */
export function useGamesEnabled(): GamesState {
  return useSyncExternalStore(subscribe, () => { if (state === null && !loaded) state = readCache(); return state; }, () => null);
}

/** The current answer for event handlers (false while unknown). */
export function gamesEnabledNow(): boolean {
  load();
  return state === true;
}
