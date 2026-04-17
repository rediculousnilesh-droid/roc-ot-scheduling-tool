/**
 * Client-side type definitions — mirrors server types needed by the client.
 */

export interface HeatmapRow {
  date: string;
  program: string;
  lobby: string;
  intervalStartTime: string;
  overUnderValue: number;
}

export interface ShiftEntry {
  agent: string;
  program: string;
  lobby: string;
  manager: string;
  date: string;
  shiftStart: string;
  shiftEnd: string;
  isWeeklyOff: boolean;
}

export interface ShiftRoster {
  entries: ShiftEntry[];
  agents: string[];
  managers: string[];
  programs: string[];
  lobbies: string[];
  dates: string[];
}

export type OTType = '1hr Pre Shift OT' | '1hr Post Shift OT' | '2hr Pre Shift OT' | '2hr Post Shift OT' | 'Full Day OT';
export type SlotStatus = 'Created' | 'Released' | 'Filled' | 'Cancelled';

export interface OTSlot {
  id: string;
  otType: OTType;
  date: string;
  program: string;
  lobby: string;
  timeWindow: string;
  status: SlotStatus;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  createdAt: string;
  releasedAt: string | null;
  filledAt: string | null;
  filledByAgentId: string | null;
  filledByAgentName: string | null;
  returnedAt: string | null;
}

export interface OTRecommendation {
  date: string;
  program: string;
  lobby: string;
  agent: string;
  manager: string;
  shift: string;
  otType: OTType;
  otTimeWindow: string;
  deficitBlock: string;
}

export interface FillRateResult {
  totalReleased: number;
  totalFilled: number;
  fillRate: number | null;
}

export interface AllFillRates {
  overall: FillRateResult;
  byProgram: Record<string, FillRateResult>;
  byManager: Record<string, FillRateResult>;
  byDate: Record<string, FillRateResult>;
  byWeek: Record<string, FillRateResult>;
  byProgramWeek: Record<string, Record<string, FillRateResult>>;
  byManagerWeek: Record<string, Record<string, FillRateResult>>;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export interface SessionMeta {
  createdAt: string;
  lastUploadAt: string | null;
  heatmapUploaded: boolean;
  rosterUploaded: boolean;
}

export interface LoginRequest {
  role: 'wfm' | 'agent' | 'manager';
  agentId?: string;
  managerName?: string;
}

export interface LoginResponse {
  success: boolean;
  token: string;
  user: {
    role: 'wfm' | 'agent' | 'manager';
    name: string;
    agentId?: string;
    program?: string;
    manager?: string;
    programs?: string[];
  };
  error?: string;
}

export interface FilterConfig {
  programs: string[];
  managers: string[];
  otTypes: OTType[];
  dateRange: {
    start: string | null;
    end: string | null;
  };
}
