"use client";

import { useSyncExternalStore } from "react";
import { api } from "@giggle/core";

/**
 * Whether stranger matching is on, as the API says (`STRANGER_DISCOVERY_ENABLED`
 * on the server is the one switch; the web build has no copy of it that could
 * drift). Unknown until the first answer arrives; the last answer is remembered
 * per browser so a reload does not flash matching controls in or out.
 */
type DiscoveryState = boolean | null;

const CACHE_KEY = "giggle.discovery";
let state: DiscoveryState = null;
let loading = false;
let loaded = false;
const listeners = new Set<() => void>();

function readCache(): DiscoveryState {
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
    .then(features => set(!!features.strangerDiscovery))
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
export function useDiscoveryEnabled(): DiscoveryState {
  return useSyncExternalStore(subscribe, () => { if (state === null && !loaded) state = readCache(); return state; }, () => null);
}

/** The current answer for event handlers (false while unknown). */
export function discoveryEnabledNow(): boolean {
  load();
  return state === true;
}
