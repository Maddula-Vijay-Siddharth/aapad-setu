export interface Coordinates {
  lat: number;
  lng: number;
}

export interface CallerContact {
  name?: string;
  phone?: string;
  verificationCode: string;
}

export type PriorityTier = "Critical" | "High" | "Moderate" | "Low";

export type DispatchAsset =
  | "NDRF Rescue Boat"
  | "ALS Ambulance"
  | "Drone Ration Drop"
  | "SDRF Rescue Truck"
  | "Standby / Monitor";

export type AgencyTag = "NDRF" | "SDRF" | "FIRE" | "MEDICAL";

export interface RecommendedDispatchItem {
  resource: DispatchAsset | string;
  quantity: number;
  reason?: string;
}

export interface AuditEntry {
  action: string;
  actor: string;
  timestamp: string;
}

export interface IncidentReport {
  id: string;
  incidentId: string;
  rawText: string;
  callerName?: string;
  callerPhone?: string;
  channel?: string;
  peopleCount: number;
  waterLevelFeet: number;
  latitude?: number;
  longitude?: number;
  createdAt: string;
  audioUrl?: string;
}

export interface DispatchAction {
  id: string;
  incidentId: string;
  assetName: DispatchAsset;
  status: "dispatched" | "en_route" | "on_scene" | "resolved" | "cancelled";
  actor: string;
  dispatchedAt: string;
  resolvedAt?: string;
}

export interface OperationalNote {
  id: string;
  incidentId: string;
  actor: string;
  note: string;
  createdAt: string;
}

export interface Incident {
  id: string;
  rawText: string;
  locationName: string;
  coordinates: Coordinates;
  waterLevelFeet: number;
  peopleCount: number;
  vulnerableGroups: string[];
  urgencyScore: number;
  priorityTier: PriorityTier;
  recommendedDispatch: DispatchAsset;
  recommendedDispatches?: RecommendedDispatchItem[];
  agencyTag: AgencyTag;
  reasoning: string;
  reasoningSteps: string[];
  status: "Pending" | "Dispatched" | "Resolved";
  timestamp: string;
  caller: CallerContact;
  isDuplicateOf?: string;
  mergedReportsCount: number;
  operationalNotes?: string | OperationalNote[] | any;
  auditLog: AuditEntry[];
  emergencyType?: string;
  landmark?: string;
  locationAccuracy?: number;
  aiSource?: "featherless" | "heuristic_fallback";
  audioUrl?: string;
  channel?: string;
  reports?: IncidentReport[];
  dispatchActions?: DispatchAction[];
  notes?: OperationalNote[];
}

export interface FleetAssetStatus {
  total: number;
  available: number;
}

export type FleetInventory = Record<DispatchAsset, FleetAssetStatus>;

export const DEFAULT_FLEET: FleetInventory = {
  "NDRF Rescue Boat": { total: 4, available: 4 },
  "ALS Ambulance": { total: 3, available: 3 },
  "Drone Ration Drop": { total: 5, available: 5 },
  "SDRF Rescue Truck": { total: 2, available: 2 },
  "Standby / Monitor": { total: 999, available: 999 },
};
