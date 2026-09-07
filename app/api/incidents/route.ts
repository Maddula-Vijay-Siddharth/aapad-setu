import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, isSupabaseConfigured, dbToIncident, incidentToDb, supabase as clientSupabase } from "@/lib/supabase";
import { evaluateTriage } from "@/lib/triage";
import type { Incident } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ incidents: [], configured: false }, { status: 200 });
    }

    const supabase = getServiceSupabase();

    let { data, error } = await supabase
      .from("incidents")
      .select(`
        *,
        incident_reports (*),
        dispatch_actions (*),
        operational_notes (*),
        audit_logs (*)
      `)
      .order("created_at", { ascending: false });

    if (error || !data) {
      const fallbackResult = await clientSupabase
        .from("incidents")
        .select(`
          *,
          incident_reports (*),
          dispatch_actions (*),
          operational_notes (*),
          audit_logs (*)
        `)
        .order("created_at", { ascending: false });
      if (fallbackResult.data) {
        data = fallbackResult.data;
        error = null;
      }
    }

    if (error || !data) {
      const simpleResult = await clientSupabase
        .from("incidents")
        .select("*")
        .order("created_at", { ascending: false });
      if (simpleResult.data) {
        data = simpleResult.data;
        error = null;
      }
    }

    if (error && !data) {
      return NextResponse.json({ error: error.message, incidents: [] }, { status: 500 });
    }

    const rawList = data || [];
    for (const row of rawList) {
      if (row.ai_source === "pending_ai") {
        try {
          const exactCoords = row.latitude != null && row.longitude != null ? { lat: Number(row.latitude), lng: Number(row.longitude) } : null;
          const evaluated = await evaluateTriage(row.description || "", exactCoords, row.landmark || row.location_name);
          const preservedPeopleCount = row.people_count != null ? Number(row.people_count) : evaluated.peopleCount;

          await supabase
            .from("incidents")
            .update({
              urgency_score: evaluated.urgencyScore,
              priority_tier: evaluated.priorityTier,
              recommended_dispatch: evaluated.recommendedDispatch,
              assigned_agency: evaluated.agencyTag,
              location_name: evaluated.locationName,
              latitude: evaluated.coordinates.lat,
              longitude: evaluated.coordinates.lng,
              people_count: preservedPeopleCount,
              water_level_feet: evaluated.waterLevelFeet,
              vulnerable_groups: evaluated.vulnerableGroups,
              reasoning: evaluated.reasoning,
              reasoning_steps: evaluated.reasoningSteps,
              ai_source: evaluated.aiSource,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);

          try {
            await supabase.from("audit_logs").insert({
              incident_id: row.id,
              action: `FEATHERLESS AI TRIAGE COMPLETED — Urgency: ${evaluated.urgencyScore} [${evaluated.priorityTier}] (${evaluated.aiSource === "featherless" ? "Featherless DeepSeek-V3" : "Heuristic Fallback"})`,
              actor: "FEATHERLESS_AI",
            });
          } catch {}

          row.urgency_score = evaluated.urgencyScore;
          row.priority_tier = evaluated.priorityTier;
          row.recommended_dispatch = evaluated.recommendedDispatch;
          row.assigned_agency = evaluated.agencyTag;
          row.location_name = evaluated.locationName;
          row.latitude = evaluated.coordinates.lat;
          row.longitude = evaluated.coordinates.lng;
          row.people_count = preservedPeopleCount;
          row.water_level_feet = evaluated.waterLevelFeet;
          row.vulnerable_groups = evaluated.vulnerableGroups;
          row.reasoning = evaluated.reasoning;
          row.reasoning_steps = evaluated.reasoningSteps;
          row.ai_source = evaluated.aiSource;
        } catch {}
      }
    }

    const incidents: Incident[] = rawList.map(dbToIncident);
    return NextResponse.json(
      { incidents, configured: true },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      }
    );
  } catch (err: unknown) {
    try {
      const { data: emergencyData } = await clientSupabase
        .from("incidents")
        .select(`
          *,
          incident_reports (*),
          dispatch_actions (*),
          operational_notes (*),
          audit_logs (*)
        `)
        .order("created_at", { ascending: false });
      if (emergencyData && emergencyData.length > 0) {
        return NextResponse.json(
          { incidents: emergencyData.map(dbToIncident), configured: true },
          { status: 200 }
        );
      }
    } catch {}
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, incidents: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: Incident = await req.json();
    if (!body || !body.locationName) {
      return NextResponse.json({ error: "Invalid incident payload." }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json(body, { status: 201 });
    }

    const supabase = getServiceSupabase();
    const dbRecord = incidentToDb(body);

    const { data: insertedIncident, error: incError } = await supabase
      .from("incidents")
      .upsert(dbRecord)
      .select()
      .single();

    if (incError) {
      return NextResponse.json({ error: incError.message }, { status: 500 });
    }

    if (body.rawText) {
      await supabase.from("incident_reports").insert({
        incident_id: insertedIncident.id,
        raw_text: body.rawText,
        caller_name: body.caller?.name || null,
        caller_phone: body.caller?.phone || null,
        channel: body.rawText.startsWith("SOS#") ? "sms" : "web",
        people_count: body.peopleCount,
        water_level_feet: body.waterLevelFeet,
        latitude: body.coordinates?.lat,
        longitude: body.coordinates?.lng,
      });
    }

    await supabase.from("audit_logs").insert({
      incident_id: insertedIncident.id,
      action: `INCIDENT LOGGED — Urgency: ${body.urgencyScore} [${body.priorityTier}]`,
      actor: "SYSTEM",
      metadata: { aiSource: body.aiSource || "featherless" },
    });

    const incident = dbToIncident({
      ...insertedIncident,
      incident_reports: [{
        raw_text: body.rawText,
        caller_name: body.caller?.name,
        caller_phone: body.caller?.phone,
        people_count: body.peopleCount,
        water_level_feet: body.waterLevelFeet,
      }],
      audit_logs: [{
        action: `INCIDENT LOGGED — Urgency: ${body.urgencyScore} [${body.priorityTier}]`,
        actor: "SYSTEM",
        timestamp: insertedIncident.created_at,
      }],
    });

    return NextResponse.json(incident, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
