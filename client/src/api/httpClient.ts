/**
 * HTTP client wrapper for all REST API calls to the server.
 */
import type {
  LoginRequest,
  LoginResponse,
  HeatmapRow,
  OTSlot,
  AllFillRates,
  OTRecommendation,
  ValidationError,
} from '../types';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('token');
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (
    options?.body &&
    typeof options.body === 'string' &&
    !headers['Content-Type']
  ) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? 'Invalid server response' : `Request failed: ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed: ${res.status}`);
  }
  return data as T;
}

export async function login(req: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function getManagers(): Promise<{ managers: string[] }> {
  return request<{ managers: string[] }>('/auth/managers');
}

export async function uploadHeatmap(
  csv: string,
): Promise<{ success: boolean; rowCount: number; errors: ValidationError[] }> {
  return request('/heatmap', {
    method: 'POST',
    body: JSON.stringify({ csv }),
  });
}

export async function getHeatmap(): Promise<{
  heatmap: HeatmapRow[];
  revised: HeatmapRow[];
}> {
  return request('/heatmap');
}

export async function uploadRoster(
  csv: string,
): Promise<{ success: boolean; entryCount: number; errors: ValidationError[] }> {
  return request('/roster', {
    method: 'POST',
    body: JSON.stringify({ csv }),
  });
}

export async function getRoster(): Promise<{
  agents: string[];
  managers: string[];
  programs: string[];
  entries: import('../types').ShiftEntry[];
}> {
  return request('/roster');
}

export async function generateSlots(
  program: string,
  tolerance?: number,
): Promise<{
  success: boolean;
  generated: number;
  summary: OTRecommendation[];
  deficitBlocks: string[];
}> {
  return request('/generate', {
    method: 'POST',
    body: JSON.stringify({ program, tolerance }),
  });
}

export async function getSlots(
  role?: string,
  agentId?: string,
): Promise<{ slots: OTSlot[] }> {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (agentId) params.set('agentId', agentId);
  const qs = params.toString();
  return request(`/slots${qs ? `?${qs}` : ''}`);
}

export async function releaseSlots(
  slotIds: string[],
): Promise<{ success: boolean }> {
  return request('/slots/release', {
    method: 'POST',
    body: JSON.stringify({ slotIds }),
  });
}

export async function cancelSlot(
  slotId: string,
): Promise<{ success: boolean }> {
  return request('/slots/cancel', {
    method: 'POST',
    body: JSON.stringify({ slotId }),
  });
}

export async function pickupSlot(
  slotId: string,
  agentId: string,
  agentName: string,
): Promise<{ success: boolean }> {
  return request('/slots/pickup', {
    method: 'POST',
    body: JSON.stringify({ slotId, agentId, agentName }),
  });
}

export async function pickupAllSlots(
  agentId: string,
  agentName: string,
): Promise<{ success: boolean; pickedUp: number; skipped: string[] }> {
  return request('/slots/pickup-all', {
    method: 'POST',
    body: JSON.stringify({ agentId, agentName }),
  });
}

export async function returnSlot(
  slotId: string,
): Promise<{ success: boolean }> {
  return request('/slots/return', {
    method: 'POST',
    body: JSON.stringify({ slotId }),
  });
}

export async function getFillRates(): Promise<AllFillRates> {
  return request('/fillrates');
}

export async function clearSession(): Promise<{ success: boolean }> {
  return request('/session/clear', { method: 'POST' });
}

export async function getSystemUser(): Promise<{ username: string }> {
  return request('/system-user');
}
