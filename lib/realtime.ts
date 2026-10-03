'use client';

import { useEffect, useRef, useState } from 'react';
import { TrackingDevice } from '@/types';
import { LIVE_REFRESH_MS, apiFetch, fetchTrackers, useApiData } from '@/lib/api';

// Live updates pushed by the backend (backend/tracker-api.js) over WebSocket.
export type RealtimeEvent =
  | {
      type: 'position';
      trackerId: string;
      lat: number;
      lng: number;
      speed: number;
      timestamp: string;
      lastSeen: string;
    }
  | {
      type: 'alert';
      trackerId: string;
      alertType: 'crash' | 'geofence';
      message: string;
      timestamp: string;
    };

// With the socket open, pages still re-read the server at this slower pace
// to pick up what is not pushed (a tracker going offline, new devices).
const BACKGROUND_REFRESH_MS = 15000;
const MAX_RECONNECT_MS = 30000;

// One socket for the whole dashboard, shared by every component that listens.
const eventListeners = new Set<(event: RealtimeEvent) => void>();
const statusListeners = new Set<(connected: boolean) => void>();
let socket: WebSocket | null = null;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 2000;
let generation = 0;

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  statusListeners.forEach((listener) => listener(value));
}

async function connect() {
  const current = ++generation;

  try {
    // A fresh ticket for every connection; the server says where to connect.
    const { url, token } = await apiFetch<{ url: string | null; token: string | null }>('/api/realtime');
    if (current !== generation || eventListeners.size === 0) return;
    if (!url || !token) return; // no backend configured: pages keep polling

    const ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
    socket = ws;

    ws.onopen = () => {
      reconnectDelay = 2000;
      setConnected(true);
    };
    ws.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        if (event.type === 'position' || event.type === 'alert') {
          eventListeners.forEach((listener) => listener(event));
        }
      } catch {
        // not JSON: ignore
      }
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      setConnected(false);
      scheduleReconnect();
    };
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer || eventListeners.size === 0) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (eventListeners.size > 0 && !socket) connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
}

function disconnect() {
  generation++;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectDelay = 2000;
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  setConnected(false);
}

// Calls onEvent for every pushed event while the component is mounted.
// Returns true while the live connection is open.
export function useRealtime(onEvent: (event: RealtimeEvent) => void): boolean {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [isConnected, setIsConnected] = useState(connected);

  useEffect(() => {
    const listener = (event: RealtimeEvent) => handler.current(event);
    eventListeners.add(listener);
    statusListeners.add(setIsConnected);
    setIsConnected(connected);

    if (!socket && !reconnectTimer) connect();

    return () => {
      eventListeners.delete(listener);
      statusListeners.delete(setIsConnected);
      if (eventListeners.size === 0) disconnect();
    };
  }, []);

  return isConnected;
}

// The trackers the user may see, kept current: positions move the moment the
// backend receives them, and the list is re-read in the background. If the
// live connection is down it falls back to re-reading every 5 seconds.
export function useLiveTrackers(paused = false) {
  const [isLive, setIsLive] = useState(connected);

  const state = useApiData<TrackingDevice[]>(
    fetchTrackers,
    [],
    paused ? undefined : isLive ? BACKGROUND_REFRESH_MS : LIVE_REFRESH_MS
  );
  const { setData } = state;

  const live = useRealtime((event) => {
    if (event.type !== 'position') return;

    setData((trackers) =>
      trackers.map((tracker) =>
        tracker.trackerId === event.trackerId
          ? {
              ...tracker,
              status: tracker.status === 'suspended' ? tracker.status : 'online',
              lastSeen: new Date(event.lastSeen),
              location: {
                lat: event.lat,
                lng: event.lng,
                speed: event.speed,
                timestamp: new Date(event.timestamp),
              },
            }
          : tracker
      )
    );
  });

  useEffect(() => setIsLive(live), [live]);

  return { ...state, live };
}
