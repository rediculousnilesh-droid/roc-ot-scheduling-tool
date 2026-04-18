/** Raw heatmap row from CSV before validation */
export interface RawHeatmapRow {
  Date?: string;
  Program?: string;
  Lobby?: string;
  Interval_Start_Time?: string;
  Over_Under_Value?: string;
  [key: string]: string | undefined;
}

/** Validated heatmap row */
export interface HeatmapRow {
  date: string;
  program: string;
  lobby: string;
  intervalStartTime: string;
  overUnderValue: number;
}

/** Raw shift roster row from CSV */
export interface RawShiftRow {
  Agent?: string;
  Program?: string;
  Manager?: string;
  [key: string]: string | undefined;
}

/** Parsed shift entry for one agent on one date */
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

/** Shift roster with derived unique values */
export interface ShiftRoster {
  entries: ShiftEntry[];
  agents: string[];
  managers: string[];
  programs: string[];
  lobbies: string[];
  dates: string[];
}

/** OT slot types */
export type OTType = '1hr Pre Shift OT' | '1hr Post Shift OT' | '2hr Pre Shift OT' | '2hr Post Shift OT' | 'Full Day OT';

/** OT slot status lifecycle */
export type SlotStatus = 'Created' | 'Released' | 'Filled' | 'Cancelled';

/** Extended OT slot with agent assignment for auto-generated slots */
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

/** Parameters for creating a new OT slot */
export interface CreateSlotParams {
  otType: OTType;
  date: string;
  program: string;
  lobby?: string;
  timeWindow: string;
}

/** Detailed OT recommendation for the table view */
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

/** Fill rate result for any grouping */
export interface FillRateResult {
  totalReleased: number;
  totalFilled: number;
  fillRate: number | null;
}

/** All fill rates computed at once for broadcast */
export interface AllFillRates {
  overall: FillRateResult;
  byProgram: Record<string, FillRateResult>;
  byManager: Record<string, FillRateResult>;
  byDate: Record<string, FillRateResult>;
  byWeek: Record<string, FillRateResult>;
  byProgramWeek: Record<string, Record<string, FillRateResult>>;
  byManagerWeek: Record<string, Record<string, FillRateResult>>;
}

/** Validation error for a specific row/field */
export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

/** Generic validation result */
export interface ValidationResult<T> {
  valid: T[];
  errors: ValidationError[];
}

/** Filter configuration for dashboard views */
export interface FilterConfig {
  programs: string[];
  managers: string[];
  otTypes: OTType[];
  dateRange: {
    start: string | null;
    end: string | null;
  };
}

/** Session metadata */
export interface SessionMeta {
  createdAt: string;
  lastUploadAt: string | null;
  heatmapUploaded: boolean;
  rosterUploaded: boolean;
}

/** Login request */
export interface LoginRequest {
  role: 'wfm' | 'agent' | 'manager';
  agentId?: string;
  managerName?: string;
}

/** Login response */
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

/** Generate request */
export interface GenerateRequest {
  program: string;
  tolerance?: number;
}

/** A contiguous block of deficit intervals */
export interface DeficitBlock {
  date: string;
  program: string;
  startInterval: string;
  endInterval: string;
  count: number;
  startIdx: number;
  endIdx: number;
}

/** A candidate OT window with computed demand metrics */
export interface DemandWindow {
  date: string;
  program: string;
  lobby: string;
  startInterval: string;
  endInterval: string;
  startIdx: number;
  endIdx: number;
  averageDeficit: number;
  effectiveDemand: number;
  toleranceIntervalsUsed: number;
  shiftStart: string;
  shiftEnd: string;
}

/** Input for the demand calculator */
export interface DemandInput {
  heatmapData: HeatmapRow[];
  shifts: ShiftEntry[];
  program: string;
  tolerance: number;
}

/** Full demand calculation result */
export interface DemandResult {
  demandWindows: DemandWindow[];
  recommendations: OTRecommendation[];
  revisedHeatmap: HeatmapRow[];
  summary: {
    total: number;
    oneHrPre: number;
    oneHrPost: number;
    twoHrPre: number;
    twoHrPost: number;
    fullDay: number;
  };
  deficitBlocks: DeficitBlock[];
}

/** Slot action requests */
export interface SlotReleaseRequest {
  slotIds: string[];
}

export interface SlotPickupRequest {
  slotId: string;
}

export interface SlotReturnRequest {
  slotId: string;
}

export interface SlotCancelRequest {
  slotId: string;
}

/** Week identifier */
export type WeekKey = string;
