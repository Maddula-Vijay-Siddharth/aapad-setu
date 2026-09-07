import { createClient } from "@supabase/supabase-js";
import type { Incident, IncidentReport, DispatchAction, OperationalNote, AuditEntry, RecommendedDispatchItem, DispatchAsset } from "./types";
import { deriveMultiDispatches } from "./triage";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export function isSupabaseConfigured(): boolean {
  if (!supabaseUrl || !supabasePublishableKey) return false;
  if (supabaseUrl.includes("your-project-id") || supabasePublishableKey.includes("your-supabase")) {
    return false;
  }
  return true;
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder-project.supabase.co",
  supabasePublishableKey || "placeholder-publishable-key"
);

export function getServerSupabase() {
  const key = supabasePublishableKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "placeholder-key";
  return createClient(
    supabaseUrl || "https://placeholder-project.supabase.co",
    key,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

export const getServiceSupabase = getServerSupabase;

export function dbToIncident(row: any): Incident {
  const reportsList = Array.isArray(row.incident_reports) ? row.incident_reports : [];
  const rawText = reportsList.length > 0 && reportsList[0].raw_text
    ? reportsList[0].raw_text
    : (row.description || "");

  const reports: IncidentReport[] = reportsList.map((r: any) => ({
    id: r.id,
    incidentId: r.incident_id,
    rawText: r.raw_text,
    callerName: r.caller_name || undefined,
    callerPhone: r.caller_phone || undefined,
    channel: r.channel || "web",
    peopleCount: Number(r.people_count || 1),
    waterLevelFeet: Number(r.water_level_feet || 0),
    latitude: r.latitude != null ? Number(r.latitude) : undefined,
    longitude: r.longitude != null ? Number(r.longitude) : undefined,
    createdAt: r.created_at,
    audioUrl: r.audio_url || undefined,
  }));

  const dispatchActions: DispatchAction[] = Array.isArray(row.dispatch_actions)
    ? row.dispatch_actions.map((d: any) => ({
        id: d.id,
        incidentId: d.incident_id,
        assetName: d.asset_name,
        status: d.status,
        actor: d.actor,
        dispatchedAt: d.dispatched_at,
        resolvedAt: d.resolved_at || undefined,
      }))
    : [];

  const notes: OperationalNote[] = Array.isArray(row.operational_notes)
    ? row.operational_notes.map((n: any) => ({
        id: n.id,
        incidentId: n.incident_id,
        actor: n.actor,
        note: n.note,
        createdAt: n.created_at,
      }))
    : [];

  const auditLog: AuditEntry[] = Array.isArray(row.audit_logs)
    ? row.audit_logs.map((a: any) => ({
        action: a.action,
        actor: a.actor,
        timestamp: a.timestamp,
      }))
    : [];

  let audioUrl: string | undefined = undefined;

  let channel = row.channel || "web";
  if (reportsList.length > 0) {
    const mmsReport = reportsList.find(
      (r: any) => r.channel && (r.channel.toLowerCase() === "mms" || r.channel.toLowerCase() === "receiver")
    );
    if (mmsReport) {
      channel = "MMS";
    } else if (reportsList[0].channel) {
      channel = reportsList[0].channel;
    }
  }

  const parsedLat = Number(row.latitude);
  const parsedLng = Number(row.longitude);
  const lat = !isNaN(parsedLat) && row.latitude !== null && row.latitude !== undefined ? parsedLat : 17.4344;
  const lng = !isNaN(parsedLng) && row.longitude !== null && row.longitude !== undefined ? parsedLng : 78.5013;

  const resolvedCallerName = (row.caller_name && row.caller_name !== "Not provided"
    ? row.caller_name
    : (reportsList.find((r: any) => r.caller_name && r.caller_name !== "Not provided")?.caller_name)) || row.caller_name || undefined;

  const resolvedCallerPhone = row.caller_phone || (reportsList.find((r: any) => r.caller_phone)?.caller_phone) || undefined;

  let recommendedDispatches: RecommendedDispatchItem[] = [];
  if (Array.isArray(row.recommended_dispatches)) {
    recommendedDispatches = row.recommended_dispatches.map((d: any) => ({
      resource: d.resource || d.asset || d.assetName || "Standby / Monitor",
      quantity: Number(d.quantity) || 1,
      reason: d.reason || undefined,
    }));
  } else if (typeof row.recommended_dispatches === "string" && row.recommended_dispatches.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(row.recommended_dispatches);
      if (Array.isArray(parsed)) {
        recommendedDispatches = parsed.map((d: any) => ({
          resource: d.resource || d.asset || d.assetName || "Standby / Monitor",
          quantity: Number(d.quantity) || 1,
          reason: d.reason || undefined,
        }));
      }
    } catch {}
  }

  if (recommendedDispatches.length === 0 && row.operational_notes && typeof row.operational_notes === "object" && Array.isArray((row.operational_notes as any).recommended_dispatches)) {
    recommendedDispatches = (row.operational_notes as any).recommended_dispatches;
  }

  if (recommendedDispatches.length === 0) {
    const rawTxt = rawText || row.description || "";
    const primary = (row.recommended_dispatch as DispatchAsset) || "Standby / Monitor";
    const pCount = Number(row.people_count != null ? row.people_count : 1);
    const uScore = Number(row.urgency_score || 50);
    recommendedDispatches = deriveMultiDispatches(uScore, rawTxt, primary, pCount);
  }

  return {
    id: row.id,
    rawText,
    locationName: row.location_name || "Disaster Zone",
    coordinates: { lat, lng },
    waterLevelFeet: Number(row.water_level_feet || 0),
    peopleCount: Number(row.people_count != null ? row.people_count : 1),
    vulnerableGroups: Array.isArray(row.vulnerable_groups) ? row.vulnerable_groups : [],
    urgencyScore: Number(row.urgency_score || 50),
    priorityTier: row.priority_tier || "Moderate",
    recommendedDispatch: row.recommended_dispatch || "Standby / Monitor",
    recommendedDispatches,
    agencyTag: row.assigned_agency || "SDRF",
    reasoning: row.reasoning || "",
    reasoningSteps: Array.isArray(row.reasoning_steps) ? row.reasoning_steps : [],
    status: row.incident_status || "Pending",
    timestamp: row.created_at || new Date().toISOString(),
    caller: {
      name: resolvedCallerName,
      phone: resolvedCallerPhone,
      verificationCode: row.verification_code || "0000",
    },
    isDuplicateOf: row.is_duplicate_of || undefined,
    mergedReportsCount: Number(row.merged_reports_count || 1),
    operationalNotes: row.operational_notes || undefined,
    auditLog,
    emergencyType: row.emergency_type || undefined,
    landmark: row.landmark || undefined,
    locationAccuracy: row.location_accuracy != null ? Number(row.location_accuracy) : undefined,
    aiSource: row.ai_source === "heuristic_fallback" ? "heuristic_fallback" : "featherless",
    audioUrl,
    channel,
    reports,
    dispatchActions,
    notes,
  };
}

export function incidentToDb(incident: Partial<Incident>): any {
  const dbRecord: Record<string, any> = {};

  if (incident.id) dbRecord.id = incident.id;
  if (incident.emergencyType !== undefined) dbRecord.emergency_type = incident.emergencyType;
  if (incident.rawText !== undefined) dbRecord.description = incident.rawText;
  if (incident.locationName !== undefined) dbRecord.location_name = incident.locationName;
  if (incident.coordinates?.lat !== undefined) dbRecord.latitude = incident.coordinates.lat;
  if (incident.coordinates?.lng !== undefined) dbRecord.longitude = incident.coordinates.lng;
  if (incident.locationAccuracy !== undefined) dbRecord.location_accuracy = incident.locationAccuracy;
  if (incident.landmark !== undefined) dbRecord.landmark = incident.landmark;
  if (incident.waterLevelFeet !== undefined) dbRecord.water_level_feet = incident.waterLevelFeet;
  if (incident.peopleCount !== undefined) dbRecord.people_count = incident.peopleCount;
  if (incident.vulnerableGroups !== undefined) dbRecord.vulnerable_groups = incident.vulnerableGroups;
  if (incident.urgencyScore !== undefined) dbRecord.urgency_score = incident.urgencyScore;
  if (incident.priorityTier !== undefined) dbRecord.priority_tier = incident.priorityTier;
  if (incident.recommendedDispatch !== undefined) dbRecord.recommended_dispatch = incident.recommendedDispatch;
  if (incident.agencyTag !== undefined) dbRecord.assigned_agency = incident.agencyTag;
  if (incident.status !== undefined) dbRecord.incident_status = incident.status;
  if (incident.caller?.name !== undefined) dbRecord.caller_name = incident.caller.name;
  if (incident.caller?.phone !== undefined) dbRecord.caller_phone = incident.caller.phone;
  if (incident.caller?.verificationCode !== undefined) dbRecord.verification_code = incident.caller.verificationCode;
  if (incident.isDuplicateOf !== undefined) dbRecord.is_duplicate_of = incident.isDuplicateOf || null;
  if (incident.mergedReportsCount !== undefined) dbRecord.merged_reports_count = incident.mergedReportsCount;
  if (incident.reasoning !== undefined) dbRecord.reasoning = incident.reasoning;
  if (incident.reasoningSteps !== undefined) dbRecord.reasoning_steps = incident.reasoningSteps;
  if (incident.aiSource !== undefined) dbRecord.ai_source = incident.aiSource;

  let opNotes = "";
  if (typeof incident.operationalNotes === "string") {
    opNotes = incident.operationalNotes;
  } else if (Array.isArray(incident.operationalNotes)) {
    opNotes = incident.operationalNotes
      .map((n: any) => (typeof n === "string" ? n : n?.note || ""))
      .filter(Boolean)
      .join(" | ");
  }
  if (incident.audioUrl && !opNotes.includes("[AUDIO]")) {
    opNotes = opNotes ? `${opNotes} | [AUDIO]: ${incident.audioUrl}` : `[AUDIO]: ${incident.audioUrl}`;
  }
  if (opNotes) {
    dbRecord.operational_notes = opNotes;
  }

  if (incident.timestamp !== undefined) dbRecord.created_at = incident.timestamp;
  dbRecord.updated_at = new Date().toISOString();

  return dbRecord;
}
