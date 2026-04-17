/**
 * Socket.IO client setup with event handlers and auto-reconnection.
 */
import { io, Socket } from 'socket.io-client';
import type { HeatmapRow, OTSlot, AllFillRates, OTRecommendation } from '../types';

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

export interface HeatmapUpdatedPayload {
  heatmap: HeatmapRow[];
  revised: HeatmapRow[];
}

export interface RosterUpdatedPayload {
  agents: string[];
  managers: string[];
  programs: string[];
}

export interface SlotsUpdatedPayload {
  slots: OTSlot[];
  fillRates: AllFillRates;
  recommendations: OTRecommendation[];
}

type Callback<T> = (data: T) => void;

let socket: Socket | null = null;

const heatmapCallbacks: Callback<HeatmapUpdatedPayload>[] = [];
const rosterCallbacks: Callback<RosterUpdatedPayload>[] = [];
const slotsCallbacks: Callback<SlotsUpdatedPayload>[] = [];
const sessionClearedCallbacks: Callback<void>[] = [];
const connectionCallbacks: Callback<ConnectionState>[] = [];

export function connect(): Socket {
  if (socket) return socket;

  socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    connectionCallbacks.forEach((cb) => cb('connected'));
  });

  socket.on('disconnect', () => {
    connectionCallbacks.forEach((cb) => cb('disconnected'));
  });

  socket.io.on('reconnect_attempt', () => {
    connectionCallbacks.forEach((cb) => cb('reconnecting'));
  });

  socket.on('heatmap:updated', (data: HeatmapUpdatedPayload) => {
    heatmapCallbacks.forEach((cb) => cb(data));
  });

  socket.on('roster:updated', (data: RosterUpdatedPayload) => {
    rosterCallbacks.forEach((cb) => cb(data));
  });

  socket.on('slots:updated', (data: SlotsUpdatedPayload) => {
    slotsCallbacks.forEach((cb) => cb(data));
  });

  socket.on('session:cleared', () => {
    sessionClearedCallbacks.forEach((cb) => cb());
  });

  return socket;
}

export function disconnect(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function onHeatmapUpdated(cb: Callback<HeatmapUpdatedPayload>): () => void {
  heatmapCallbacks.push(cb);
  return () => {
    const idx = heatmapCallbacks.indexOf(cb);
    if (idx >= 0) heatmapCallbacks.splice(idx, 1);
  };
}

export function onRosterUpdated(cb: Callback<RosterUpdatedPayload>): () => void {
  rosterCallbacks.push(cb);
  return () => {
    const idx = rosterCallbacks.indexOf(cb);
    if (idx >= 0) rosterCallbacks.splice(idx, 1);
  };
}

export function onSlotsUpdated(cb: Callback<SlotsUpdatedPayload>): () => void {
  slotsCallbacks.push(cb);
  return () => {
    const idx = slotsCallbacks.indexOf(cb);
    if (idx >= 0) slotsCallbacks.splice(idx, 1);
  };
}

export function onSessionCleared(cb: Callback<void>): () => void {
  sessionClearedCallbacks.push(cb);
  return () => {
    const idx = sessionClearedCallbacks.indexOf(cb);
    if (idx >= 0) sessionClearedCallbacks.splice(idx, 1);
  };
}

export function onConnectionStatus(cb: Callback<ConnectionState>): () => void {
  connectionCallbacks.push(cb);
  return () => {
    const idx = connectionCallbacks.indexOf(cb);
    if (idx >= 0) connectionCallbacks.splice(idx, 1);
  };
}

export function getSocket(): Socket | null {
  return socket;
}
