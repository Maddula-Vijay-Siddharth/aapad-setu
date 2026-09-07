import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { DEFAULT_FLEET } from "@/lib/types";
import type { FleetInventory, DispatchAsset } from "@/lib/types";

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(DEFAULT_FLEET, { status: 200 });
    }

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from("fleet_inventory")
      .select("asset_name, total, available");

    if (error || !data || data.length === 0) {
      for (const [name, status] of Object.entries(DEFAULT_FLEET)) {
        await supabase.from("fleet_inventory").upsert({
          asset_name: name,
          total: status.total,
          available: status.available,
          updated_at: new Date().toISOString(),
        });
      }
      return NextResponse.json(DEFAULT_FLEET, { status: 200 });
    }

    const fleet: FleetInventory = { ...DEFAULT_FLEET };
    for (const item of data) {
      if (item.asset_name in fleet) {
        fleet[item.asset_name as DispatchAsset] = {
          total: Number(item.total),
          available: Number(item.available),
        };
      }
    }

    return NextResponse.json(fleet, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(DEFAULT_FLEET, { status: 200 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body: { assetName: DispatchAsset; available: number; total?: number } = await req.json();
    if (!body || !body.assetName) {
      return NextResponse.json({ error: "Missing assetName" }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const supabase = getServiceSupabase();
    const updateData: Record<string, any> = {
      available: Math.max(0, body.available),
      updated_at: new Date().toISOString(),
    };
    if (body.total !== undefined) {
      updateData.total = Math.max(0, body.total);
    }

    const { error } = await supabase
      .from("fleet_inventory")
      .update(updateData)
      .eq("asset_name", body.assetName);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
