"use client";

import { useSyncExternalStore } from "react";

import type { ParcelResult } from "@/lib/parcels/counties";

/**
 * Parcel watchlist + recent-lookup persistence for the parcels page rail.
 *
 * Contract (frozen with ParcelRail / ParcelViewer): two localStorage keys —
 * 'rai-parcel-watching' and 'rai-parcel-recent' — each holding a JSON array
 * of SavedParcel, newest first. Every mutation writes storage (best-effort)
 * and broadcasts a window CustomEvent named 'rai-parcel-list-change'; the
 * hooks below also re-read on cross-tab 'storage' events. Server snapshot is
 * [] and corrupt storage parses as [].
 */

export interface SavedParcel {
  key: string;
  county: string;
  apn?: string;
  address?: string;
  acres?: number;
  landUse?: string;
  lng?: number;
  lat?: number;
  savedAt: number;
}

export const WATCHING_KEY = "rai-parcel-watching";
export const RECENT_KEY = "rai-parcel-recent";
export const PARCEL_LIST_EVENT = "rai-parcel-list-change";

const WATCHING_CAP = 50;
const RECENT_CAP = 20;

const SERVER_SNAPSHOT: SavedParcel[] = [];

/**
 * Per-key snapshot cache. getSnapshot must return a stable reference or
 * useSyncExternalStore loops forever — re-parse only when the stored string
 * actually changes.
 */
const snapshots = new Map<string, { raw: string | null; list: SavedParcel[] }>();

function parseList(raw: string): SavedParcel[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedParcel =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SavedParcel).key === "string" &&
        typeof (item as SavedParcel).county === "string",
    );
  } catch {
    return [];
  }
}

function readList(storageKey: string): SavedParcel[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    // storage unavailable — treat as empty
  }
  const cached = snapshots.get(storageKey);
  if (cached && cached.raw === raw) return cached.list;
  const list = raw === null ? [] : parseList(raw);
  snapshots.set(storageKey, { raw, list });
  return list;
}

function writeList(storageKey: string, list: SavedParcel[]): void {
  const raw = JSON.stringify(list);
  try {
    localStorage.setItem(storageKey, raw);
    snapshots.set(storageKey, { raw, list });
  } catch {
    // private mode / quota exceeded — the change won't stick; still broadcast
    // so same-tab listeners re-read whatever is actually stored.
  }
  window.dispatchEvent(new CustomEvent(PARCEL_LIST_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(PARCEL_LIST_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(PARCEL_LIST_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

const watchingSnapshot = () => readList(WATCHING_KEY);
const recentSnapshot = () => readList(RECENT_KEY);
const serverSnapshot = () => SERVER_SNAPSHOT;

/** Parcels the user is watching, newest first (cap 50). */
export function useWatching(): SavedParcel[] {
  return useSyncExternalStore(subscribe, watchingSnapshot, serverSnapshot);
}

/** Parcels recently looked up, newest first (cap 20). */
export function useRecent(): SavedParcel[] {
  return useSyncExternalStore(subscribe, recentSnapshot, serverSnapshot);
}

/** Dedupe by key, unshift newest, cap the list. */
function unshiftCapped(storageKey: string, cap: number, p: SavedParcel): void {
  const list = readList(storageKey).filter((item) => item.key !== p.key);
  list.unshift(p);
  writeList(storageKey, list.slice(0, cap));
}

export function watchParcel(p: SavedParcel): void {
  unshiftCapped(WATCHING_KEY, WATCHING_CAP, p);
}

export function unwatchParcel(key: string): void {
  writeList(
    WATCHING_KEY,
    readList(WATCHING_KEY).filter((item) => item.key !== key),
  );
}

export function recordRecent(p: SavedParcel): void {
  unshiftCapped(RECENT_KEY, RECENT_CAP, p);
}

export function removeRecent(key: string): void {
  writeList(
    RECENT_KEY,
    readList(RECENT_KEY).filter((item) => item.key !== key),
  );
}

/**
 * Build a SavedParcel from a lookup result. The key is county + APN/address
 * so repeat lookups of the same parcel dedupe; coords are optional because
 * callers don't always have the geometry centroid.
 */
export function toSavedParcel(
  p: ParcelResult,
  coords?: { lng: number; lat: number },
): SavedParcel {
  const savedAt = Date.now();
  return {
    key: `${p.county}:${p.apn ?? p.address ?? savedAt}`,
    county: p.county,
    apn: p.apn,
    address: p.address,
    acres: p.acres,
    landUse: p.landUse,
    lng: coords?.lng,
    lat: coords?.lat,
    savedAt,
  };
}
