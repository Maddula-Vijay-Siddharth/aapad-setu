import { NextRequest, NextResponse } from "next/server";
import type { Incident } from "@/lib/types";
import { getServiceSupabase, isSupabaseConfigured, dbToIncident, incidentToDb } from "@/lib/supabase";
import { evaluateTriage, findDuplicate, extractCaller } from "@/lib/triage";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message: string = body.message || "";
    let existingIncidents: Incident[] = Array.isArray(body.existingIncidents) ? body.existingIncidents : [];

    if (!message.trim()) {
      return NextResponse.json({ error: "Missing distress message." }, { status: 400 });
    }

    if (existingIncidents.length === 0 && isSupabaseConfigured()) {
      const supabase = getServiceSupabase();
      const { data: dbIncidents } = await supabase
        .from("incidents")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (dbIncidents) {
        existingIncidents = dbIncidents.map(dbToIncident);
      }
    }

    const caller = extractCaller(message);
    const evaluated = await evaluateTriage(message);

    const duplicateParent = findDuplicate(evaluated.coordinates, evaluated.locationName, existingIncidents);
    let isDuplicateOf: string | undefined = undefined;
    let mergedReportsCount = 1;

    if (duplicateParent) {
      isDuplicateOf = duplicateParent.id;
      mergedReportsCount = (duplicateParent.mergedReportsCount || 1) + 1;
    }

    const isSafe = /safe|rescued|cancel.*sos|no longer|all clear/i.test(message.toLowerCase());
    const finalStatus = isSafe ? "Resolved" : "Pending";
    const incidentId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const incident: Incident = {
      id: incidentId,
      rawText: message,
      ...evaluated,
      peopleCount: evaluated.peopleCount,
      status: finalStatus,
      timestamp,
      caller,
      mergedReportsCount,
      auditLog: [
        {
          action: `INCIDENT LOGGED — Urgency: ${evaluated.urgencyScore} [${evaluated.priorityTier}] (${evaluated.aiSource === "featherless" ? "Featherless DeepSeek-V3" : "Heuristic Fallback"})`,
          actor: "SYSTEM",
          timestamp,
        },
      ],
      aiSource: evaluated.aiSource,
      channel: "web",
      ...(isDuplicateOf ? { isDuplicateOf } : {}),
    };

    if (isSupabaseConfigured()) {
      const supabase = getServiceSupabase();

      if (duplicateParent) {
        await supabase
          .from("incidents")
          .update({
            merged_reports_count: mergedReportsCount,
            updated_at: new Date().toISOString(),
          })
          .eq("id", duplicateParent.id);

        await supabase.from("incident_reports").insert({
          incident_id: duplicateParent.id,
          raw_text: message,
          caller_name: caller.name || null,
          caller_phone: caller.phone || null,
          channel: message.startsWith("SOS#") ? "sms" : "web",
          people_count: evaluated.peopleCount,
          water_level_feet: evaluated.waterLevelFeet,
          latitude: evaluated.coordinates.lat,
          longitude: evaluated.coordinates.lng,
        });

        await supabase.from("audit_logs").insert({
          incident_id: duplicateParent.id,
          action: `MERGED DUPLICATE REPORT — New report recorded (total reports: ${mergedReportsCount})`,
          actor: "SYSTEM",
          metadata: { duplicateOf: duplicateParent.id, callerPhone: caller.phone },
        });

        const dbRecord = incidentToDb(incident);
        await supabase.from("incidents").insert(dbRecord);
      } else {
        const dbRecord = incidentToDb(incident);
        await supabase.from("incidents").insert(dbRecord);

        await supabase.from("incident_reports").insert({
          incident_id: incidentId,
          raw_text: message,
          caller_name: caller.name || null,
          caller_phone: caller.phone || null,
          channel: message.startsWith("SOS#") ? "sms" : "web",
          people_count: evaluated.peopleCount,
          water_level_feet: evaluated.waterLevelFeet,
          latitude: evaluated.coordinates.lat,
          longitude: evaluated.coordinates.lng,
        });

        await supabase.from("audit_logs").insert({
          incident_id: incidentId,
          action: `INCIDENT LOGGED — Urgency: ${evaluated.urgencyScore} [${evaluated.priorityTier}]`,
          actor: "SYSTEM",
          metadata: { aiSource: evaluated.aiSource },
        });
      }
    }

    return NextResponse.json(incident, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: `Triage engine failure: ${msg}` }, { status: 500 });
  }
}
