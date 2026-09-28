// Stable per-browser device identity (spec §12). Supplementary audit context;
// it never replaces user authentication.

import type { DeviceType } from "@pcos/types";

const KEY = "pcos.deviceId";
const TYPE_KEY = "pcos.deviceType";
let cached: string | null = null;
let typeCache: DeviceType | null = null;

function uuid(): string {
  return crypto.randomUUID();
}

export function deviceId(): string | null {
  if (typeof window === "undefined") return null;
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = uuid();
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached = cached ?? uuid();
  }
  return cached;
}

export function deviceType(): DeviceType | null {
  if (typeof window === "undefined") return null;
  if (typeCache) return typeCache;
  try {
    typeCache = (localStorage.getItem(TYPE_KEY) as DeviceType | null) ?? null;
  } catch {
    /* storage unavailable */
  }
  return typeCache;
}

/** Surfaces declare what kind of device they run on (unless the operator chose explicitly). */
export function suggestDeviceType(type: DeviceType, force = false) {
  if (typeof window === "undefined") return;
  if (!force && deviceType()) return;
  typeCache = type;
  try {
    localStorage.setItem(TYPE_KEY, type);
  } catch {
    /* ignore */
  }
}

export const APP_VERSION = "0.1.0";
