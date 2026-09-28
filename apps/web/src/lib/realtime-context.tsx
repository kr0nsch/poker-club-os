"use client";

import type { RealtimeEvent } from "@pcos/types";
import { createContext, useContext, useEffect, useEffectEvent, useState, useSyncExternalStore, type ReactNode } from "react";
import { RealtimeClient, type RealtimeSnapshot } from "./realtime";

const Ctx = createContext<RealtimeClient | null>(null);

/** One realtime connection per page. Displays/kiosks pass their access token. */
export function RealtimeProvider({ children, params }: { children: ReactNode; params?: Record<string, string> }) {
  const [client] = useState(() => (typeof window === "undefined" ? null : new RealtimeClient(params)));
  useEffect(() => {
    client?.start();
    return () => client?.stop();
  }, [client]);
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function useRealtimeClient() {
  return useContext(Ctx);
}

const SERVER_SNAPSHOT: RealtimeSnapshot = { socket: "connecting", connectivity: "LOCAL_CONNECTED", edge: null, offsetMs: 0, epoch: 0, principal: null };

export function useRealtimeState(): RealtimeSnapshot {
  const client = useRealtimeClient();
  return useSyncExternalStore(
    (cb) => client?.subscribeState(cb) ?? (() => undefined),
    () => client?.getSnapshot() ?? SERVER_SNAPSHOT,
    () => SERVER_SNAPSHOT,
  );
}

/** Subscribe to topics and receive their events. */
export function useTopicEvents(topics: (string | null | undefined)[], onEvent: (e: RealtimeEvent) => void) {
  const client = useRealtimeClient();
  const handle = useEffectEvent(onEvent);
  const key = topics.filter(Boolean).join("|");
  useEffect(() => {
    if (!client) return;
    const list = key ? key.split("|") : [];
    const unsubs = list.map((t) => client.subscribe(t));
    const off = client.onEvent((e) => {
      if (e.topics.includes("*") || e.topics.some((t) => list.includes(t))) handle(e);
    });
    return () => {
      off();
      unsubs.forEach((u) => u());
    };
  }, [client, key]);
}

/** Server-corrected "now", re-rendering every `intervalMs`. */
export function useServerNow(intervalMs = 250): number {
  const client = useRealtimeClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(client ? client.now() : Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [client, intervalMs]);
  return now;
}
