import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, isSupabaseConfigured, dbToIncident } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Missing incident id" }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ id, ...body, updated: true }, { status: 200 });
    }

    const supabase = getServiceSupabase();
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.status !== undefined) updatePayload.incident_status = body.status;
    if (body.priorityTier !== undefined) updatePayload.priority_tier = body.priorityTier;
    if (body.recommendedDispatch !== undefined) updatePayload.recommended_dispatch = body.recommendedDispatch;
    if (body.operationalNotes !== undefined) updatePayload.operational_notes = body.operationalNotes;
    if (body.peopleCount !== undefined) updatePayload.people_count = body.peopleCount;
    if (body.mergedReportsCount !== undefined) updatePayload.merged_reports_count = body.mergedReportsCount;

    const { data: updatedIncident, error: updateError } = await supabase
      .from("incidents")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const dispatchList: Array<{ assetName: string; quantity: number; actor?: string }> = [];
    if (Array.isArray(body.dispatchActions) && body.dispatchActions.length > 0) {
      for (const item of body.dispatchActions) {
        if (item && item.assetName && item.quantity > 0) {
          const rawName = item.assetName === "Drone Recon Unit" ? "Drone Ration Drop" : item.assetName;
          dispatchList.push({
            assetName: rawName,
            quantity: Math.max(1, Number(item.quantity)),
            actor: item.actor || body.actor || "DISPATCHER-CAD",
          });
        }
      }
    } else if (body.dispatchAction && body.dispatchAction.assetName) {
      const rawName = body.dispatchAction.assetName === "Drone Recon Unit" ? "Drone Ration Drop" : body.dispatchAction.assetName;
      dispatchList.push({
        assetName: rawName,
        quantity: 1,
        actor: body.dispatchAction.actor || body.actor || "DISPATCHER-CAD",
      });
    }

    if (dispatchList.length > 0) {
      const rowsToInsert: any[] = [];
      for (const item of dispatchList) {
        for (let i = 0; i < item.quantity; i++) {
          rowsToInsert.push({
            incident_id: id,
            asset_name: item.assetName,
            status: "dispatched",
            actor: item.actor || "DISPATCHER-CAD",
            dispatched_at: new Date().toISOString(),
          });
        }

        if (item.assetName !== "Standby / Monitor") {
          const { data: currentAsset } = await supabase
            .from("fleet_inventory")
            .select("available")
            .eq("asset_name", item.assetName)
            .single();

          if (currentAsset) {
            await supabase
              .from("fleet_inventory")
              .update({
                available: Math.max(0, currentAsset.available - item.quantity),
                updated_at: new Date().toISOString(),
              })
              .eq("asset_name", item.assetName);
          }
        }
      }

      if (rowsToInsert.length > 0) {
        await supabase.from("dispatch_actions").insert(rowsToInsert);
      }

      const summary = dispatchList.map((d) => `${d.assetName} × ${d.quantity}`).join(", ");
      await supabase.from("audit_logs").insert({
        incident_id: id,
        action: `DISPATCH AUTHORIZED — ${summary}`,
        actor: dispatchList[0]?.actor || "DISPATCHER-CAD",
        metadata: { dispatches: dispatchList },
      });
    }

    if (body.status === "Resolved" || body.resolveAction || body.resolveActions) {
      const actor = body.actor || body.resolveAction?.actor || "DISPATCHER-CAD";
      const { data: activeDispatches } = await supabase
        .from("dispatch_actions")
        .select("asset_name")
        .eq("incident_id", id)
        .eq("status", "dispatched");

      if (activeDispatches && activeDispatches.length > 0) {
        await supabase
          .from("dispatch_actions")
          .update({
            status: "resolved",
            resolved_at: new Date().toISOString(),
          })
          .eq("incident_id", id)
          .eq("status", "dispatched");

        const counts: Record<string, number> = {};
        for (const row of activeDispatches) {
          counts[row.asset_name] = (counts[row.asset_name] || 0) + 1;
        }

        for (const [assetName, qty] of Object.entries(counts)) {
          if (assetName !== "Standby / Monitor") {
            const { data: currentAsset } = await supabase
              .from("fleet_inventory")
              .select("total, available")
              .eq("asset_name", assetName)
              .single();

            if (currentAsset) {
              await supabase
                .from("fleet_inventory")
                .update({
                  available: Math.min(currentAsset.total, currentAsset.available + qty),
                  updated_at: new Date().toISOString(),
                })
                .eq("asset_name", assetName);
            }
          }
        }

        const summary = Object.entries(counts).map(([name, qty]) => `${name} × ${qty}`).join(", ");
        await supabase.from("audit_logs").insert({
          incident_id: id,
          action: `RESOLVED — Returned to pool: ${summary}`,
          actor,
          metadata: { returned: counts },
        });
      } else if (body.resolveAction?.assetName && body.resolveAction.assetName !== "Standby / Monitor") {
        const asset = body.resolveAction.assetName === "Drone Recon Unit" ? "Drone Ration Drop" : body.resolveAction.assetName;
        const { data: currentAsset } = await supabase
          .from("fleet_inventory")
          .select("total, available")
          .eq("asset_name", asset)
          .single();

        if (currentAsset) {
          await supabase
            .from("fleet_inventory")
            .update({
              available: Math.min(currentAsset.total, currentAsset.available + 1),
              updated_at: new Date().toISOString(),
            })
            .eq("asset_name", asset);
        }
      }
    }

    if (body.operationalNotes && body.appendNote) {
      await supabase.from("operational_notes").insert({
        incident_id: id,
        actor: body.actor || "ADMIN-01",
        note: body.operationalNotes,
      });

      await supabase.from("audit_logs").insert({
        incident_id: id,
        action: `OVERRIDE — Tier: ${body.priorityTier || updatedIncident.priority_tier}, Dispatch: ${body.recommendedDispatch || updatedIncident.recommended_dispatch}`,
        actor: body.actor || "ADMIN-01",
        metadata: { notes: body.operationalNotes },
      });
    }

    const { data: fullData } = await supabase
      .from("incidents")
      .select(`
        *,
        incident_reports (*),
        dispatch_actions (*),
        operational_notes (*),
        audit_logs (*)
      `)
      .eq("id", id)
      .single();

    const incident = fullData ? dbToIncident(fullData) : dbToIncident(updatedIncident);
    return NextResponse.json(incident, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
