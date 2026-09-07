import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, isSupabaseConfigured, dbToIncident, incidentToDb } from "@/lib/supabase";
import { evaluateTriage, findDuplicate, extractCaller } from "@/lib/triage";
import type { Incident, Coordinates } from "@/lib/types";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "aapadsetu-receiver-ingest",
    version: "1.0",
    time: new Date().toISOString(),
  });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

function parseSafeDate(val: string | number | undefined | null): string {
  if (!val) return new Date().toISOString();
  try {
    if (typeof val === "number" || /^\d+$/.test(String(val).trim())) {
      const ms = typeof val === "number" ? val : parseInt(String(val).trim(), 10);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {}
  return new Date().toISOString();
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    const headerIdempotency = req.headers.get("x-idempotency-key") || req.headers.get("x-report-id") || "";

    let rawMessage = "";
    let senderPhone = "";
    let victimName = "";
    let peopleAffectedStr = "";
    let emergencyType = "";
    let description = "";
    let landmark = "";
    let latitude: number | null = null;
    let longitude: number | null = null;
    let locationAccuracy: number | null = null;
    let timestampStr = "";
    let channel = "MMS";
    let reportId = headerIdempotency;
    let audioBuffer: Buffer | null = null;
    let audioMimeType = "audio/3gpp";
    let audioExtension = "3gp";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      rawMessage = String(formData.get("rawMessage") || formData.get("rawText") || formData.get("message") || formData.get("reportText") || "");
      senderPhone = String(formData.get("senderPhone") || formData.get("phone") || "");
      victimName = String(formData.get("victimName") || formData.get("name") || "");
      peopleAffectedStr = String(formData.get("peopleAffected") || formData.get("peopleCount") || "");
      emergencyType = String(formData.get("emergencyType") || formData.get("type") || "");
      description = String(formData.get("description") || "");
      landmark = String(formData.get("landmark") || "");
      channel = String(formData.get("channel") || formData.get("source") || "MMS");
      reportId = String(formData.get("reportId") || formData.get("idempotencyKey") || formData.get("id") || "");
      timestampStr = String(formData.get("timestamp") || formData.get("receivedTime") || "");

      const latVal = formData.get("latitude") || formData.get("lat");
      if (latVal) latitude = parseFloat(String(latVal));

      const lngVal = formData.get("longitude") || formData.get("lng") || formData.get("long");
      if (lngVal) longitude = parseFloat(String(lngVal));

      const accVal = formData.get("accuracy") || formData.get("gpsAccuracy") || formData.get("locationAccuracy");
      if (accVal) locationAccuracy = parseFloat(String(accVal).replace(/m$/i, "").trim());

      const file = formData.get("audio") || formData.get("audioFile") || formData.get("file");
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        const arrayBuf = await (file as File).arrayBuffer();
        audioBuffer = Buffer.from(arrayBuf);
        if ((file as File).type) audioMimeType = (file as File).type;
        const name = (file as File).name || "";
        const ext = name.split(".").pop();
        if (ext) audioExtension = ext;
      }
    } else {
      const body = await req.json();
      rawMessage = String(body.rawMessage || body.rawText || body.message || body.reportText || "");
      senderPhone = String(body.senderPhone || body.phone || "");
      victimName = String(body.victimName || body.name || "");
      peopleAffectedStr = String(body.peopleAffected || body.peopleCount || "");
      emergencyType = String(body.emergencyType || body.type || "");
      description = String(body.description || "");
      landmark = String(body.landmark || "");
      channel = String(body.channel || body.source || "MMS");
      reportId = String(body.reportId || body.idempotencyKey || body.id || "");
      timestampStr = String(body.timestamp || body.receivedTime || "");

      if (body.latitude !== undefined && body.latitude !== null && body.latitude !== "Not available") {
        const val = parseFloat(String(body.latitude));
        if (!isNaN(val)) latitude = val;
      } else if (body.lat !== undefined && body.lat !== null) {
        const val = parseFloat(String(body.lat));
        if (!isNaN(val)) latitude = val;
      }

      if (body.longitude !== undefined && body.longitude !== null && body.longitude !== "Not available") {
        const val = parseFloat(String(body.longitude));
        if (!isNaN(val)) longitude = val;
      } else if (body.lng !== undefined && body.lng !== null) {
        const val = parseFloat(String(body.lng));
        if (!isNaN(val)) longitude = val;
      } else if (body.long !== undefined && body.long !== null) {
        const val = parseFloat(String(body.long));
        if (!isNaN(val)) longitude = val;
      }

      if (body.accuracy !== undefined && body.accuracy !== null && body.accuracy !== "Not available") {
        const val = parseFloat(String(body.accuracy).replace(/m$/i, "").trim());
        if (!isNaN(val)) locationAccuracy = val;
      } else if (body.locationAccuracy !== undefined && body.locationAccuracy !== null) {
        const val = parseFloat(String(body.locationAccuracy).replace(/m$/i, "").trim());
        if (!isNaN(val)) locationAccuracy = val;
      }

      const audioInput = body.audioBase64 || body.audio || body.audioData;
      if (audioInput && typeof audioInput === "string") {
        let cleanBase64 = audioInput;
        if (audioInput.includes(",")) {
          const parts = audioInput.split(",");
          const mimeMatch = parts[0].match(/:(.*?);/);
          if (mimeMatch) audioMimeType = mimeMatch[1];
          cleanBase64 = parts[1];
        }
        if (body.audioMimeType) audioMimeType = body.audioMimeType;
        if (body.audioExtension) audioExtension = body.audioExtension;
        audioBuffer = Buffer.from(cleanBase64, "base64");
      }
    }

    if (!rawMessage.trimStart().startsWith("EMERGENCY REPORT")) {
      return NextResponse.json(
        { success: false, rejected: true, error: "Rejected: Not an emergency report. Message must start with 'EMERGENCY REPORT'." },
        { status: 400 }
      );
    }

    const lines = rawMessage.split(/\r?\n/).map((l) => l.trim());
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith("name:")) {
        const val = line.substring(line.indexOf(":") + 1).trim();
        if (!victimName && val && !val.toLowerCase().includes("not provided")) victimName = val;
      } else if (lower.startsWith("phone:")) {
        const val = line.substring(line.indexOf(":") + 1).trim();
        if (!senderPhone && val && !val.toLowerCase().includes("not provided")) senderPhone = val;
      } else if (lower.startsWith("people affected:") || lower.startsWith("people:")) {
        const val = line.substring(line.indexOf(":") + 1).trim();
        if (!peopleAffectedStr && val) peopleAffectedStr = val;
      } else if (lower.startsWith("emergency type:") || lower.startsWith("type:")) {
        const val = line.substring(line.indexOf(":") + 1).trim();
        if (!emergencyType && val) emergencyType = val;
      } else if (lower.startsWith("description:")) {
        const val = line.substring(line.indexOf(":") + 1).trim();
        if (!description && val && val.toLowerCase() !== "none" && val.toLowerCase() !== "not provided") description = val;
      } else if (lower.startsWith("latitude:") || lower.startsWith("lat:")) {
        if (latitude === null) {
          const val = parseFloat(line.substring(line.indexOf(":") + 1).trim());
          if (!isNaN(val)) latitude = val;
        }
      } else if (lower.startsWith("longitude:") || lower.startsWith("lng:") || lower.startsWith("long:")) {
        if (longitude === null) {
          const val = parseFloat(line.substring(line.indexOf(":") + 1).trim());
          if (!isNaN(val)) longitude = val;
        }
      } else if (lower.startsWith("accuracy:")) {
        if (locationAccuracy === null) {
          const rawAcc = line.substring(line.indexOf(":") + 1).trim().replace(/m$/i, "").trim();
          const val = parseFloat(rawAcc);
          if (!isNaN(val)) locationAccuracy = val;
        }
      } else if (lower.startsWith("landmark:")) {
        const val = line.substring(line.indexOf(":") + 1).trim();
        if (!landmark && val && !val.toLowerCase().includes("not provided")) landmark = val;
      }
    }

    let parsedPeopleCount = 1;
    if (peopleAffectedStr) {
      const numMatch = peopleAffectedStr.match(/\d+/);
      if (numMatch) parsedPeopleCount = Math.max(1, parseInt(numMatch[0], 10));
    }

    if (!emergencyType) emergencyType = "General Emergency";
    if (!landmark) landmark = "Not provided";
    if (!description || description.toLowerCase() === "none" || description.toLowerCase() === "not provided") {
      description = "Emergency reported via DisasterReceiver";
    }

    let exactCoordinates: Coordinates | null = null;
    if (latitude !== null && longitude !== null && !isNaN(latitude) && !isNaN(longitude)) {
      exactCoordinates = { lat: latitude, lng: longitude };
    }

    let audioUrl: string | undefined = undefined;
    const supabase = isSupabaseConfigured() ? getServiceSupabase() : null;

    if (audioBuffer && audioBuffer.length > 0 && supabase) {
      try {
        const audioId = reportId || crypto.randomUUID();
        const pathName = `reports/${audioId}-${Date.now()}.${audioExtension}`;
        const { error: uploadError } = await supabase.storage
          .from("emergency-audio")
          .upload(pathName, audioBuffer, {
            contentType: audioMimeType,
            upsert: true,
          });

        if (!uploadError) {
          const { data: publicData } = supabase.storage
            .from("emergency-audio")
            .getPublicUrl(pathName);
          if (publicData?.publicUrl) {
            audioUrl = publicData.publicUrl;
          }
        }
      } catch {}
    }

    const idempotencyKey = reportId || (senderPhone ? `${senderPhone}-${timestampStr || Date.now()}` : "");

    if (idempotencyKey && supabase) {
      const { data: existingAudit } = await supabase
        .from("audit_logs")
        .select("incident_id")
        .eq("metadata->>idempotencyKey", idempotencyKey)
        .limit(1);

      if (existingAudit && existingAudit.length > 0) {
        const existingId = existingAudit[0].incident_id;
        const { data: existingInc } = await supabase
          .from("incidents")
          .select(`
            *,
            incident_reports (*),
            dispatch_actions (*),
            operational_notes (*),
            audit_logs (*)
          `)
          .eq("id", existingId)
          .single();

        if (existingInc) {
          return NextResponse.json(
            {
              success: true,
              action: "duplicate",
              duplicate: true,
              duplicateReport: true,
              idempotent: true,
              incidentId: existingId,
              incident: dbToIncident(existingInc),
            },
            { status: 200 }
          );
        }
      }
    }

    let existingIncidents: Incident[] = [];
    if (supabase) {
      const { data: dbIncidents } = await supabase
        .from("incidents")
        .select(`
          *,
          incident_reports (*),
          dispatch_actions (*),
          operational_notes (*),
          audit_logs (*)
        `)
        .order("created_at", { ascending: false })
        .limit(50);
      if (dbIncidents) {
        existingIncidents = dbIncidents.map(dbToIncident);
      }
    }

    const evaluated = await evaluateTriage(
      rawMessage,
      exactCoordinates,
      landmark !== "Not provided" ? landmark : undefined
    );

    const callerContact = extractCaller(rawMessage);
    if (victimName && victimName !== "Not provided") callerContact.name = victimName;
    if (senderPhone && senderPhone !== "Not provided") callerContact.phone = senderPhone;

    let duplicateParent: Incident | undefined = undefined;
    if (exactCoordinates) {
      duplicateParent = findDuplicate(exactCoordinates, landmark !== "Not provided" ? landmark : evaluated.locationName, existingIncidents);
    }

    const incidentId = crypto.randomUUID();
    const finalTimestamp = parseSafeDate(timestampStr);

    if (duplicateParent && supabase) {
      const newReportCount = (duplicateParent.mergedReportsCount || 1) + 1;
      const mergedPeopleCount = Math.max(duplicateParent.peopleCount, parsedPeopleCount);

      await supabase
        .from("incidents")
        .update({
          merged_reports_count: newReportCount,
          people_count: mergedPeopleCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", duplicateParent.id);

      await supabase.from("incident_reports").insert({
        incident_id: duplicateParent.id,
        raw_text: rawMessage,
        caller_name: callerContact.name || null,
        caller_phone: callerContact.phone || null,
        channel,
        people_count: parsedPeopleCount,
        water_level_feet: evaluated.waterLevelFeet,
        latitude: exactCoordinates ? exactCoordinates.lat : null,
        longitude: exactCoordinates ? exactCoordinates.lng : null,
      });

      await supabase.from("audit_logs").insert({
        incident_id: duplicateParent.id,
        action: `MERGED RECEIVER REPORT — Source: ${channel} (Report count: ${newReportCount})`,
        actor: "DISASTER_RECEIVER",
        metadata: {
          idempotencyKey,
          reportId,
          channel,
          callerPhone: callerContact.phone,
          audioUrl: audioUrl || null,
        },
      });

      if (audioUrl) {
        await supabase.from("operational_notes").insert({
          incident_id: duplicateParent.id,
          actor: "DISASTER_RECEIVER",
          note: `[AUDIO]: ${audioUrl}`,
        });
      }

      const { data: updatedParent } = await supabase
        .from("incidents")
        .select(`
          *,
          incident_reports (*),
          dispatch_actions (*),
          operational_notes (*),
          audit_logs (*)
        `)
        .eq("id", duplicateParent.id)
        .single();

      return NextResponse.json(
        {
          success: true,
          action: "merged",
          duplicate: true,
          duplicateReport: true,
          parentIncidentId: duplicateParent.id,
          incident: updatedParent ? dbToIncident(updatedParent) : duplicateParent,
        },
        { status: 200 }
      );
    }

    const incident: Incident = {
      id: incidentId,
      rawText: rawMessage,
      locationName: landmark !== "Not provided" ? landmark : evaluated.locationName,
      coordinates: exactCoordinates || evaluated.coordinates,
      waterLevelFeet: evaluated.waterLevelFeet,
      peopleCount: parsedPeopleCount,
      vulnerableGroups: evaluated.vulnerableGroups,
      urgencyScore: evaluated.urgencyScore,
      priorityTier: evaluated.priorityTier,
      recommendedDispatch: evaluated.recommendedDispatch,
      agencyTag: evaluated.agencyTag,
      reasoning: evaluated.reasoning,
      reasoningSteps: evaluated.reasoningSteps,
      status: "Pending",
      timestamp: finalTimestamp,
      caller: callerContact,
      mergedReportsCount: 1,
      emergencyType,
      landmark: landmark !== "Not provided" ? landmark : undefined,
      locationAccuracy: locationAccuracy || undefined,
      aiSource: evaluated.aiSource,
      audioUrl,
      channel,
      operationalNotes: audioUrl ? `[AUDIO]: ${audioUrl}` : undefined,
      auditLog: [
        {
          action: `RECEIVER REPORT INGESTED — Urgency: ${evaluated.urgencyScore} [${evaluated.priorityTier}] (${evaluated.aiSource === "featherless" ? "Featherless DeepSeek-V3" : "Heuristic Fallback"})`,
          actor: "DISASTER_RECEIVER",
          timestamp: finalTimestamp,
        },
      ],
    };

    if (supabase) {
      const dbRecord = incidentToDb(incident);
      await supabase.from("incidents").insert(dbRecord);

      await supabase.from("incident_reports").insert({
        incident_id: incidentId,
        raw_text: rawMessage,
        caller_name: callerContact.name || null,
        caller_phone: callerContact.phone || null,
        channel,
        people_count: parsedPeopleCount,
        water_level_feet: evaluated.waterLevelFeet,
        latitude: exactCoordinates ? exactCoordinates.lat : null,
        longitude: exactCoordinates ? exactCoordinates.lng : null,
      });

      await supabase.from("audit_logs").insert({
        incident_id: incidentId,
        action: `RECEIVER EMERGENCY REPORT INGESTED — Urgency: ${evaluated.urgencyScore} [${evaluated.priorityTier}]`,
        actor: "DISASTER_RECEIVER",
        metadata: {
          idempotencyKey,
          reportId,
          channel,
          callerPhone: callerContact.phone,
          audioUrl: audioUrl || null,
        },
      });

      if (audioUrl) {
        await supabase.from("operational_notes").insert({
          incident_id: incidentId,
          actor: "DISASTER_RECEIVER",
          note: `[AUDIO]: ${audioUrl}`,
        });
      }
    }

    return NextResponse.json(
      {
        success: true,
        action: "created",
        incidentId: incident.id,
        status: incident.status,
        priorityTier: incident.priorityTier,
        urgencyScore: incident.urgencyScore,
        recommendedDispatch: incident.recommendedDispatch,
        agencyTag: incident.agencyTag,
        locationName: incident.locationName,
        coordinates: incident.coordinates,
        locationAccuracy: incident.locationAccuracy,
        peopleCount: incident.peopleCount,
        audioUrl: incident.audioUrl,
        channel: incident.channel,
        aiSource: incident.aiSource,
        incident,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: `Receiver ingest failure: ${msg}` }, { status: 500 });
  }
}
