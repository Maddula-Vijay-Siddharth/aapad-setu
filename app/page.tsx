"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Incident, FleetInventory, PriorityTier, DispatchAsset, DispatchAction } from "@/lib/types";
import { DEFAULT_FLEET } from "@/lib/types";
import { supabase, isSupabaseConfigured, dbToIncident } from "@/lib/supabase";

const LeafletMap = dynamic(() => import("@/components/LeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400 text-xs font-mono">
      INITIALIZING RESCUE MAP…
    </div>
  ),
});

type FilterMode = "all" | "Critical" | "High" | "Moderate";

function formatIncidentTime(ts?: string): string {
  if (!ts) return "Just now";
  const date = new Date(ts);
  if (isNaN(date.getTime())) return ts;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AapadSetuDashboard() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [fleet, setFleet] = useState<FleetInventory>({ ...DEFAULT_FLEET });
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showFleetModal, setShowFleetModal] = useState(false);
  const [fleetSavedMsg, setFleetSavedMsg] = useState(false);
  const [activeNav, setActiveNav] = useState<"overview" | "incidents" | "fleet">("overview");
  const [confirmResolveId, setConfirmResolveId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});

  const refreshIncidents = useCallback(async () => {
    try {
      const res = await fetch(`/api/incidents?t=${Date.now()}`, {
        cache: "no-store",
        headers: { Pragma: "no-cache", "Cache-Control": "no-cache" },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.incidents) && data.incidents.length > 0) {
          setIncidents((prev) => {
            const map = new Map<string, Incident>();
            for (const inc of data.incidents) {
              map.set(inc.id, inc);
            }
            for (const inc of prev) {
              if (!map.has(inc.id)) {
                map.set(inc.id, inc);
              }
            }
            return Array.from(map.values()).sort(
              (a, b) =>
                new Date(b.timestamp || 0).getTime() -
                new Date(a.timestamp || 0).getTime()
            );
          });
        }
      }
    } catch {}
  }, []);

  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch(`/api/fleet?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          setFleet((prev) => ({ ...prev, ...data }));
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDirectFromSupabase() {
      if (!isSupabaseConfigured() || !supabase) return;
      try {
        const { data, error } = await supabase
          .from("incidents")
          .select(
            `
            *,
            incident_reports (*),
            dispatch_actions (*),
            triage_evaluations (
              id,
              urgency_score,
              priority_tier,
              dispatch_recommendation,
              assigned_agency,
              reasoning,
              created_at
            )
          `
          )
          .order("created_at", { ascending: false });

        if (!error && data && !cancelled && data.length > 0) {
          const directIncidents = data.map((row: any) => dbToIncident(row));
          setIncidents((prev) => {
            const map = new Map<string, Incident>();
            for (const inc of directIncidents) {
              map.set(inc.id, inc);
            }
            for (const inc of prev) {
              if (!map.has(inc.id)) {
                map.set(inc.id, inc);
              }
            }
            return Array.from(map.values()).sort(
              (a, b) =>
                new Date(b.timestamp || 0).getTime() -
                new Date(a.timestamp || 0).getTime()
            );
          });
        }
      } catch {}
    }

    loadDirectFromSupabase();
    refreshIncidents();
    fetchFleet();
    const interval = setInterval(refreshIncidents, 8000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshIncidents, fetchFleet]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    const channel = supabase
      .channel("dashboard-realtime-incidents")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "incidents" },
        async (payload: any) => {
          const newRow = payload.new;
          if (!newRow) return;

          const tempIncident = dbToIncident(newRow);
          setIncidents((prev) => {
            const exists = prev.some((i) => i.id === tempIncident.id);
            if (exists) return prev;
            return [tempIncident, ...prev];
          });

          refreshIncidents();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "incidents" },
        async (payload: any) => {
          const updatedRow = payload.new;
          if (!updatedRow) return;

          const updatedIncident = dbToIncident(updatedRow);
          setIncidents((prev) =>
            prev.map((i) =>
              i.id === updatedIncident.id ? { ...i, ...updatedIncident } : i
            )
          );
          setSelectedIncident((curr) =>
            curr && curr.id === updatedIncident.id
              ? { ...curr, ...updatedIncident }
              : curr
          );

          refreshIncidents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshIncidents]);

  useEffect(() => {
    if (incidents.length > 0 && !selectedIncident) {
      const activeFirst = incidents.find((i) => i.status !== "Resolved") || incidents[0];
      setSelectedIncident(activeFirst);
    } else if (selectedIncident) {
      const match = incidents.find((i) => i.id === selectedIncident.id);
      if (match && match.status !== selectedIncident.status) {
        setSelectedIncident(match);
      }
    }
  }, [incidents, selectedIncident]);

  const dispatchOptions: { key: DispatchAsset; label: string }[] = useMemo(
    () => [
      { key: "NDRF Rescue Boat", label: "NDRF Rescue Boat" },
      { key: "ALS Ambulance", label: "ALS Ambulance" },
      { key: "Drone Ration Drop", label: "Drone Recon Unit" },
      { key: "SDRF Rescue Truck", label: "SDRF Rescue Truck" },
    ],
    []
  );

  useEffect(() => {
    setSelectedQuantities({});
  }, [selectedIncident?.id]);

  const toggleResourceSelection = (key: DispatchAsset) => {
    setSelectedQuantities((prev) => {
      const current = prev[key] || 0;
      const available = fleet[key]?.available || 0;
      if (current > 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      } else {
        if (available <= 0) return prev;
        return {
          ...prev,
          [key]: 1,
        };
      }
    });
  };

  const updateResourceQuantity = (key: DispatchAsset, delta: number) => {
    setSelectedQuantities((prev) => {
      const current = prev[key] || 0;
      if (current <= 0 && delta <= 0) return prev;
      const available = fleet[key]?.available || 0;
      const nextVal = Math.max(1, Math.min(available, (current || 1) + delta));
      return {
        ...prev,
        [key]: nextVal,
      };
    });
  };

  const totalSelectedUnits = useMemo(() => {
    return Object.values(selectedQuantities).reduce((sum, q) => sum + (q > 0 ? q : 0), 0);
  }, [selectedQuantities]);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      if (incident.status === "Resolved") return false;
      if (filter !== "all" && incident.priorityTier !== filter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const typeMatch = (incident.emergencyType || "").toLowerCase().includes(query);
        const locMatch = (incident.locationName || incident.landmark || "").toLowerCase().includes(query);
        const callerMatch = (incident.caller?.name || "").toLowerCase().includes(query);
        const textMatch = (incident.rawText || "").toLowerCase().includes(query);
        const idMatch = (incident.id || "").toLowerCase().includes(query);
        if (!typeMatch && !locMatch && !callerMatch && !textMatch && !idMatch) {
          return false;
        }
      }
      return true;
    });
  }, [incidents, filter, searchQuery]);

  const criticalAlerts = useMemo(() => {
    return incidents
      .filter((i) => i.status !== "Resolved")
      .sort((a, b) => {
        const pScore = (p: PriorityTier) => (p === "Critical" ? 3 : p === "High" ? 2 : p === "Moderate" ? 1 : 0);
        const diff = pScore(b.priorityTier) - pScore(a.priorityTier);
        if (diff !== 0) return diff;
        return (b.urgencyScore || 0) - (a.urgencyScore || 0);
      });
  }, [incidents]);

  const validMapIncidents = useMemo(() => {
    return filteredIncidents.filter(
      (i) =>
        i &&
        i.coordinates &&
        typeof i.coordinates.lat === "number" &&
        !isNaN(i.coordinates.lat) &&
        typeof i.coordinates.lng === "number" &&
        !isNaN(i.coordinates.lng)
    );
  }, [filteredIncidents]);

  const activeIncidentsCount = incidents.filter((i) => i.status !== "Resolved").length;
  const criticalCount = incidents.filter((i) => i.priorityTier === "Critical" && i.status !== "Resolved").length;
  const highCount = incidents.filter((i) => i.priorityTier === "High" && i.status !== "Resolved").length;
  const moderateCount = incidents.filter((i) => i.priorityTier === "Moderate" && i.status !== "Resolved").length;
  const dispatchedCount = incidents.filter((i) => i.status === "Dispatched").length;
  const resolvedCount = incidents.filter((i) => i.status === "Resolved").length;
  const totalPeopleAffected = incidents
    .filter((i) => i.status !== "Resolved")
    .reduce((sum, i) => sum + (i.peopleCount || 1), 0);

  const fleetAssets: { key: DispatchAsset; label: string; icon: string }[] = [
    { key: "NDRF Rescue Boat", label: "NDRF Rescue Boats", icon: "🚤" },
    { key: "ALS Ambulance", label: "ALS Ambulances", icon: "🚑" },
    { key: "Drone Ration Drop", label: "Drone Recon Units", icon: "🛸" },
    { key: "SDRF Rescue Truck", label: "SDRF Rescue Trucks", icon: "🚒" },
  ];

  const totalFleetUnits = fleetAssets.reduce((sum, a) => sum + (fleet[a.key]?.total || 0), 0);
  const availableFleetUnits = fleetAssets.reduce((sum, a) => sum + (fleet[a.key]?.available || 0), 0);
  const deployedFleetUnits = totalFleetUnits - availableFleetUnits;

  const getDispatchedList = (incident: Incident): Array<{ assetName: string; quantity: number }> => {
    const list = incident.dispatchActions || [];
    const active = list.filter((d) => d.status === "dispatched" || (incident.status === "Resolved" && d.status === "resolved"));
    if (active.length > 0) {
      const counts: Record<string, number> = {};
      for (const item of active) {
        const name = item.assetName === "Drone Ration Drop" ? "Drone Recon Unit" : item.assetName;
        counts[name] = (counts[name] || 0) + 1;
      }
      return Object.entries(counts).map(([assetName, quantity]) => ({ assetName, quantity }));
    }
    const fallbackName = incident.recommendedDispatch === "Drone Ration Drop" ? "Drone Recon Unit" : incident.recommendedDispatch;
    return [{ assetName: fallbackName, quantity: 1 }];
  };

  const getDispatchedAsset = (incident: Incident): string => {
    const list = getDispatchedList(incident);
    return list.map((item) => `${item.assetName} × ${item.quantity}`).join(", ");
  };

  const getRecommendedList = (incident: Incident): Array<{ resource: string; quantity: number; reason?: string }> => {
    if (Array.isArray(incident.recommendedDispatches) && incident.recommendedDispatches.length > 0) {
      return incident.recommendedDispatches.map((r) => ({
        resource: r.resource === "Drone Ration Drop" ? "Drone Recon Unit" : r.resource,
        quantity: r.quantity || 1,
        reason: r.reason,
      }));
    }
    const name = incident.recommendedDispatch === "Drone Ration Drop" ? "Drone Recon Unit" : incident.recommendedDispatch;
    return [{ resource: name, quantity: 1 }];
  };

  const updateFleetAsset = async (
    assetName: DispatchAsset,
    targetAvailable: number,
    targetTotal?: number
  ) => {
    const current = fleet[assetName] || { available: 0, total: 1 };
    const newTotal = targetTotal !== undefined ? Math.max(1, targetTotal) : current.total;
    const newAvailable = Math.max(0, Math.min(newTotal, targetAvailable));

    setFleet((prev) => ({
      ...prev,
      [assetName]: {
        available: newAvailable,
        total: newTotal,
      },
    }));

    setFleetSavedMsg(true);
    setTimeout(() => setFleetSavedMsg(false), 2500);

    try {
      await fetch("/api/fleet", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetName,
          available: newAvailable,
          total: newTotal,
        }),
      });
    } catch {}
  };

  const handleDispatchResources = async (incident: Incident) => {
    if (incident.status === "Dispatched" || incident.status === "Resolved") return;
    if (totalSelectedUnits <= 0) return;
    setActionLoading(true);

    const dispatchActionsPayload: Array<{ assetName: DispatchAsset; quantity: number; actor: string }> = [];
    const newLocalActions: DispatchAction[] = [];

    for (const opt of dispatchOptions) {
      const qty = selectedQuantities[opt.key] || 0;
      if (qty > 0) {
        dispatchActionsPayload.push({
          assetName: opt.key,
          quantity: qty,
          actor: "DISPATCHER-CAD",
        });
        for (let i = 0; i < qty; i++) {
          newLocalActions.push({
            id: `disp-${Date.now()}-${opt.key}-${i}`,
            incidentId: incident.id,
            assetName: opt.key,
            status: "dispatched",
            actor: "DISPATCHER-CAD",
            dispatchedAt: new Date().toISOString(),
          });
        }
      }
    }

    const newStatus = "Dispatched";
    setIncidents((prev) =>
      prev.map((i) =>
        i.id === incident.id
          ? {
              ...i,
              status: newStatus,
              dispatchActions: [...(i.dispatchActions || []), ...newLocalActions],
            }
          : i
      )
    );
    setSelectedIncident((prev) =>
      prev && prev.id === incident.id
        ? {
            ...prev,
            status: newStatus,
            dispatchActions: [...(prev.dispatchActions || []), ...newLocalActions],
          }
        : prev
    );

    setFleet((prev) => {
      const nextFleet = { ...prev };
      for (const item of dispatchActionsPayload) {
        const cur = nextFleet[item.assetName] || { available: 1, total: 1 };
        nextFleet[item.assetName] = {
          ...cur,
          available: Math.max(0, cur.available - item.quantity),
        };
      }
      return nextFleet;
    });

    try {
      const res = await fetch(`/api/incidents/${incident.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          dispatchActions: dispatchActionsPayload,
        }),
      });

      if (!res.ok && isSupabaseConfigured() && supabase) {
        await supabase
          .from("incidents")
          .update({ incident_status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", incident.id);
      }
    } catch {
      if (isSupabaseConfigured() && supabase) {
        await supabase
          .from("incidents")
          .update({ incident_status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", incident.id);
      }
    } finally {
      setActionLoading(false);
      refreshIncidents();
      fetchFleet();
    }
  };

  const handleResolveIncident = async (incident: Incident) => {
    if (incident.status === "Resolved") return;
    setActionLoading(true);
    setConfirmResolveId(null);

    const newStatus = "Resolved";
    const activeDispatches = (incident.dispatchActions || []).filter((d) => d.status === "dispatched");
    const counts: Record<string, number> = {};
    if (activeDispatches.length > 0) {
      for (const d of activeDispatches) {
        counts[d.assetName] = (counts[d.assetName] || 0) + 1;
      }
    } else {
      counts[incident.recommendedDispatch] = 1;
    }

    setIncidents((prev) =>
      prev.map((i) =>
        i.id === incident.id
          ? {
              ...i,
              status: newStatus,
              dispatchActions: (i.dispatchActions || []).map((d) =>
                d.status === "dispatched" ? { ...d, status: "resolved" as const } : d
              ),
            }
          : i
      )
    );
    setSelectedIncident((prev) =>
      prev && prev.id === incident.id
        ? {
            ...prev,
            status: newStatus,
            dispatchActions: (prev.dispatchActions || []).map((d) =>
              d.status === "dispatched" ? { ...d, status: "resolved" as const } : d
            ),
          }
        : prev
    );

    setFleet((prev) => {
      const nextFleet = { ...prev };
      for (const [assetName, qty] of Object.entries(counts)) {
        const cur = nextFleet[assetName as DispatchAsset];
        if (cur) {
          nextFleet[assetName as DispatchAsset] = {
            ...cur,
            available: Math.min(cur.total, cur.available + qty),
          };
        }
      }
      return nextFleet;
    });

    try {
      const res = await fetch(`/api/incidents/${incident.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
        }),
      });

      if (!res.ok && isSupabaseConfigured() && supabase) {
        await supabase
          .from("incidents")
          .update({ incident_status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", incident.id);
      }
    } catch {
      if (isSupabaseConfigured() && supabase) {
        await supabase
          .from("incidents")
          .update({ incident_status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", incident.id);
      }
    } finally {
      setActionLoading(false);
      refreshIncidents();
      fetchFleet();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex font-sans antialiased selection:bg-blue-100">
      <aside className="w-56 bg-white border-r border-slate-200 shrink-0 hidden md:flex flex-col justify-between py-4 px-3 sticky top-0 h-screen z-30">
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 px-2">
            <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center text-white font-black text-sm tracking-wider shadow-xs">
              A
            </div>
            <div>
              <div className="font-bold text-sm text-slate-900 leading-none tracking-tight">
                Aapad Setu
              </div>
              <div className="text-[10px] text-slate-400 font-medium tracking-wide mt-0.5">
                DISASTER CAD
              </div>
            </div>
          </div>

          <nav className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 mb-1.5">
              Navigation
            </div>
            <button
              onClick={() => setActiveNav("overview")}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-medium transition ${
                activeNav === "overview"
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span>Map View</span>
            </button>

            <Link
              href="/incidents"
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Incidents</span>
              </div>
              <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded">
                {activeIncidentsCount}
              </span>
            </Link>

            <button
              onClick={() => setShowAnalytics(true)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span>Analytics</span>
            </button>

            <button
              onClick={() => setShowFleetModal(true)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>Fleet / Resources</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-600 font-bold">
                {availableFleetUnits}
              </span>
            </button>
          </nav>

          <div className="pt-3 border-t border-slate-100 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 mb-1.5">
              Operational
            </div>
            <div className="px-2.5 py-1.5 text-xs text-slate-600 flex items-center justify-between">
              <span className="text-slate-500">Live Sync</span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Active
              </span>
            </div>
            <div className="px-2.5 py-1.5 text-xs text-slate-600 flex items-center justify-between">
              <span className="text-slate-500">Triage Engine</span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-blue-600 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Ready
              </span>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 px-2 text-[11px] text-slate-400 font-mono">
          CAD System v2.4
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-20 shadow-2xs">
          <div className="flex items-center gap-3 w-72 md:w-96">
            <div className="relative w-full">
              <input
                type="text"
                placeholder="Search emergency type, location, caller..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1 text-xs bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:border-blue-500 transition text-slate-800 placeholder:text-slate-400"
              />
              <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 font-mono">
              <span>Sync Channel:</span>
              <span className="font-semibold text-slate-700">SMS-Relay + MMS</span>
            </div>

            <div className="h-3 w-px bg-slate-200 hidden sm:block" />

            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/60 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Live Operational</span>
            </div>
          </div>
        </header>

        <main className="p-5 lg:p-6 space-y-5 max-w-[1700px] w-full mx-auto">
          <div>
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <h1 className="text-xl lg:text-2xl font-bold text-slate-900 tracking-tight">
                Operational Overview
              </h1>
              <div className="text-[11px] text-slate-400 font-mono">
                Last synced: Just now • Region: Active Flood Grid
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time disaster response monitoring and intelligent resource coordination.
            </p>
          </div>

          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-white border border-slate-200 rounded-md p-3.5 shadow-2xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Active Incidents
              </div>
              <div className="flex items-baseline justify-between mt-1.5">
                <div className="text-2xl font-black text-slate-900 font-mono">
                  {activeIncidentsCount}
                </div>
                <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                  Live Feed
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {dispatchedCount} dispatched • {resolvedCount} resolved
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3.5 shadow-2xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                People Affected
              </div>
              <div className="flex items-baseline justify-between mt-1.5">
                <div className="text-2xl font-black text-slate-900 font-mono">
                  {totalPeopleAffected}
                </div>
                <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                  Active
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Direct verified victim count
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3.5 shadow-2xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Units Available / Deployed
              </div>
              <div className="flex items-baseline justify-between mt-1.5">
                <div className="text-2xl font-black text-slate-900 font-mono">
                  {availableFleetUnits} <span className="text-xs font-normal text-slate-400 font-sans">/ {totalFleetUnits}</span>
                </div>
                <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                  {deployedFleetUnits} Deployed
                </span>
              </div>
              <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${Math.round((availableFleetUnits / (totalFleetUnits || 1)) * 100)}%` }}
                />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3.5 shadow-2xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Critical Incidents
              </div>
              <div className="flex items-baseline justify-between mt-1.5">
                <div className="text-2xl font-black text-red-600 font-mono">
                  {criticalCount}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                  High Priority
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {highCount} high urgency • {moderateCount} moderate
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 space-y-4">
              <div className="bg-white border border-slate-200 rounded-md shadow-2xs overflow-hidden flex flex-col">
                <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-white">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Live Rescue Map
                    </h2>
                    <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {validMapIncidents.length} active plotted
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {(["all", "Critical", "High", "Moderate"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded transition ${
                          filter === f
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {f === "all" ? "All" : f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="relative w-full h-[440px] bg-slate-100">
                  <LeafletMap
                    incidents={filteredIncidents}
                    selectedIncident={selectedIncident}
                    onSelectIncident={(inc) => setSelectedIncident(inc)}
                  />
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-md shadow-2xs p-4 lg:p-5">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Incident Intelligence
                    </h2>
                    {selectedIncident && (
                      <span className="text-[10px] font-mono text-slate-400">
                        REF: {selectedIncident.id}
                      </span>
                    )}
                  </div>

                  {selectedIncident && (
                    <span
                      className={`text-[11px] font-bold font-mono px-2 py-0.5 rounded ${
                        selectedIncident.status === "Dispatched"
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : selectedIncident.status === "Resolved"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-800 border border-amber-200"
                      }`}
                    >
                      {selectedIncident.status || "Active / New"}
                    </span>
                  )}
                </div>

                {!selectedIncident ? (
                  <div className="py-10 text-center">
                    <p className="text-xs font-semibold text-slate-700">No Incident Selected</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Click any marker on the map or select an alert to inspect triage details.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 pb-3.5 border-b border-slate-200 text-xs">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Emergency Type
                        </span>
                        <span className="font-semibold text-slate-900 text-sm mt-0.5 block truncate">
                          {selectedIncident.emergencyType || "Emergency"}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Priority
                        </span>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider mt-0.5 ${
                            selectedIncident.priorityTier === "Critical"
                              ? "bg-red-100 text-red-800 border border-red-200"
                              : selectedIncident.priorityTier === "High"
                              ? "bg-amber-100 text-amber-800 border border-amber-200"
                              : "bg-blue-100 text-blue-800 border border-blue-200"
                          }`}
                        >
                          {selectedIncident.priorityTier}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Location
                        </span>
                        <span className="font-medium text-slate-800 truncate mt-0.5 block">
                          {selectedIncident.locationName || selectedIncident.landmark || "N/A"}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          People Affected
                        </span>
                        <span className="font-bold text-slate-900 text-sm mt-0.5 block font-mono">
                          {selectedIncident.peopleCount ?? 1}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Caller Name
                        </span>
                        <span className="text-slate-800 mt-0.5 block font-medium">
                          {selectedIncident.caller?.name || "Unknown"}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Caller Phone
                        </span>
                        <span className="text-slate-800 font-mono mt-0.5 block">
                          {selectedIncident.caller?.phone || "N/A"}
                        </span>
                      </div>

                      <div className="col-span-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          GPS Coordinates
                        </span>
                        <span className="text-slate-700 font-mono mt-0.5 block">
                          {selectedIncident.coordinates
                            ? `${selectedIncident.coordinates.lat.toFixed(5)}, ${selectedIncident.coordinates.lng.toFixed(5)}`
                            : "No GPS reported"}
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-md p-3.5 border border-slate-200/80 space-y-3.5">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                        Dispatch Coordination
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="p-3 bg-white rounded border border-slate-200">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Urgency Score
                          </span>
                          <div className="flex items-baseline gap-1 mt-0.5">
                            <span className="text-2xl font-black text-slate-900 font-mono">
                              {selectedIncident.urgencyScore}
                            </span>
                            <span className="text-xs text-slate-400 font-mono">/ 100</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
                            <div
                              className={`h-full rounded-full ${
                                selectedIncident.urgencyScore >= 75
                                  ? "bg-red-600"
                                  : selectedIncident.urgencyScore >= 50
                                  ? "bg-amber-500"
                                  : "bg-blue-600"
                              }`}
                              style={{ width: `${selectedIncident.urgencyScore}%` }}
                            />
                          </div>
                        </div>

                        <div className="p-3 bg-white rounded border border-slate-200">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                            AI RECOMMENDATION
                          </span>
                          <div className="space-y-1">
                            {getRecommendedList(selectedIncident).map((item, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                                <span className="text-blue-600 font-bold">✓</span>
                                <span>{item.resource}</span>
                                <span className="text-slate-500 font-mono text-[11px]">× {item.quantity}</span>
                              </div>
                            ))}
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-1.5">
                            AI Triage Assessment
                          </span>
                        </div>

                        <div className="p-3 bg-white rounded border border-slate-200">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Assigned Agency
                          </span>
                          <div className="text-xs font-bold text-slate-900 mt-1">
                            {selectedIncident.agencyTag}
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-1">
                            Coordinating unit
                          </span>
                        </div>
                      </div>

                      {selectedIncident.status === "Pending" && (
                        <div className="pt-3 border-t border-slate-200/70 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-700">
                              DISPATCH RESOURCES
                            </div>
                            <div className="text-xs font-medium text-slate-500">
                              Total selected: <strong className="text-slate-900 font-mono font-bold">{totalSelectedUnits}</strong> {totalSelectedUnits === 1 ? "resource" : "resources"}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {dispatchOptions.map((opt) => {
                              const avail = fleet[opt.key]?.available || 0;
                              const isChecked = (selectedQuantities[opt.key] || 0) > 0;
                              const qty = selectedQuantities[opt.key] || 0;
                              const isDisabled = avail <= 0;

                              return (
                                <div
                                  key={opt.key}
                                  className={`p-2.5 rounded border transition flex items-center justify-between gap-2 ${
                                    isDisabled
                                      ? "bg-slate-100 border-slate-200 opacity-60"
                                      : isChecked
                                      ? "bg-blue-50/70 border-blue-300 ring-1 ring-blue-300"
                                      : "bg-white border-slate-200 hover:border-slate-300"
                                  }`}
                                >
                                  <label className="flex items-center gap-2.5 cursor-pointer select-none min-w-0 flex-1">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      disabled={isDisabled}
                                      onChange={() => toggleResourceSelection(opt.key)}
                                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                                    />
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-slate-900 truncate">
                                        {opt.label}
                                      </div>
                                      <div className="text-[10px] text-slate-500 font-mono">
                                        Available: <strong className={avail > 0 ? "text-slate-700" : "text-red-600"}>{avail}</strong>
                                      </div>
                                    </div>
                                  </label>

                                  {isChecked && (
                                    <div className="flex items-center gap-1.5 shrink-0 bg-white border border-slate-200 rounded px-1 py-0.5 shadow-2xs">
                                      <button
                                        type="button"
                                        onClick={() => updateResourceQuantity(opt.key, -1)}
                                        disabled={qty <= 1}
                                        className="w-5 h-5 flex items-center justify-center rounded text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                                      >
                                        −
                                      </button>
                                      <span className="w-5 text-center text-xs font-bold font-mono text-slate-900">
                                        {qty}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => updateResourceQuantity(opt.key, 1)}
                                        disabled={qty >= avail}
                                        className="w-5 h-5 flex items-center justify-center rounded text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            <div className="text-[11px] text-slate-500">
                              {totalSelectedUnits === 0 ? "Check one or more resources above to deploy" : `${totalSelectedUnits} unit(s) queued for immediate dispatch`}
                            </div>

                            <button
                              onClick={() => handleDispatchResources(selectedIncident)}
                              disabled={actionLoading || totalSelectedUnits === 0}
                              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition disabled:opacity-50 shrink-0"
                            >
                              {totalSelectedUnits === 0
                                ? "Select resources to dispatch"
                                : totalSelectedUnits === 1
                                ? "Dispatch 1 Resource"
                                : `Dispatch ${totalSelectedUnits} Resources`}
                            </button>
                          </div>
                        </div>
                      )}

                      {selectedIncident.status === "Dispatched" && (
                        <div className="pt-3 border-t border-slate-200/70 space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded border border-slate-200">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                                DISPATCHED RESOURCES
                              </span>
                              <div className="space-y-1">
                                {getDispatchedList(selectedIncident).map((item, idx) => (
                                  <div key={idx} className="flex items-center gap-2 text-xs font-bold text-blue-700">
                                    <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                                    <span>{item.assetName}</span>
                                    <span className="font-mono text-slate-600 font-semibold">× {item.quantity}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1">
                                Units currently en route / on scene
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {confirmResolveId === selectedIncident.id ? (
                                <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded">
                                  <span className="text-xs font-medium text-emerald-900">
                                    Complete incident & return units to fleet?
                                  </span>
                                  <button
                                    onClick={() => handleResolveIncident(selectedIncident)}
                                    disabled={actionLoading}
                                    className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded transition disabled:opacity-50"
                                  >
                                    Complete Incident
                                  </button>
                                  <button
                                    onClick={() => setConfirmResolveId(null)}
                                    disabled={actionLoading}
                                    className="px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded transition"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmResolveId(selectedIncident.id)}
                                  disabled={actionLoading}
                                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition disabled:opacity-50 shadow-2xs"
                                >
                                  Complete Incident
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedIncident.status === "Resolved" && (
                        <div className="pt-3 border-t border-slate-200/70 space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded border border-slate-200">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                                DISPATCHED RESOURCES (RESOLVED)
                              </span>
                              <div className="space-y-1">
                                {getDispatchedList(selectedIncident).map((item, idx) => (
                                  <div key={idx} className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                                    <span>{item.assetName}</span>
                                    <span className="font-mono text-slate-500">× {item.quantity}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="text-[10px] text-emerald-600 font-medium mt-1">
                                All units returned to ready fleet inventory
                              </div>
                            </div>

                            <div className="px-3.5 py-1.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 shrink-0">
                              <span>✓</span>
                              <span>Incident Resolved</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white border border-slate-200 rounded-md shadow-2xs overflow-hidden flex flex-col h-[480px]">
                <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Critical Alerts
                    </h2>
                    <span className="text-[10px] font-mono text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.2 rounded font-bold">
                      {criticalCount}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Priority Queue
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                  {criticalAlerts.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-xs">
                      No active alerts in queue.
                    </div>
                  ) : (
                    criticalAlerts.map((incident) => {
                      const isSelected = selectedIncident?.id === incident.id;
                      const isCritical = incident.priorityTier === "Critical";
                      const isHigh = incident.priorityTier === "High";

                      return (
                        <div
                          key={incident.id}
                          onClick={() => setSelectedIncident(incident)}
                          className={`p-3 cursor-pointer transition text-left border-l-3 ${
                            isCritical
                              ? "border-l-red-600"
                              : isHigh
                              ? "border-l-amber-500"
                              : "border-l-blue-500"
                          } ${
                            isSelected
                              ? "bg-blue-50/50 ring-1 ring-inset ring-blue-300"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5 mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`inline-block px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider rounded ${
                                  isCritical
                                    ? "bg-red-100 text-red-700"
                                    : isHigh
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-blue-100 text-blue-700"
                                }`}
                              >
                                {incident.priorityTier}
                              </span>
                              <span className="font-semibold text-xs text-slate-900 truncate">
                                {incident.emergencyType || "Emergency"}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono shrink-0">
                              {formatIncidentTime(incident.timestamp)}
                            </span>
                          </div>

                          <div className="text-xs text-slate-600 truncate mb-1.5">
                            {incident.locationName || incident.landmark || "Location pending"}
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                            <span>
                              <strong className="text-slate-700 font-semibold font-mono">
                                {incident.peopleCount ?? 1}
                              </strong>{" "}
                              affected
                            </span>
                            <span
                              className={`text-[10px] font-medium font-mono px-1.5 py-0.2 rounded ${
                                incident.status === "Dispatched"
                                  ? "bg-blue-50 text-blue-700 font-semibold"
                                  : incident.status === "Resolved"
                                  ? "bg-emerald-50 text-emerald-700 font-semibold"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {incident.status || "Pending"}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div id="fleet-section" className="bg-white border border-slate-200 rounded-md shadow-2xs p-4">
                <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Quick Operations / Resources
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      {availableFleetUnits} Ready
                    </span>
                    <button
                      onClick={() => setShowFleetModal(true)}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition"
                    >
                      Manage
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {fleetAssets.map((item) => {
                    const assetData = fleet[item.key] || { available: 0, total: 1 };
                    const pct = Math.round((assetData.available / assetData.total) * 100);
                    return (
                      <div
                        key={item.key}
                        className="p-2.5 bg-slate-50 rounded border border-slate-200/70"
                      >
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-medium text-slate-700 flex items-center gap-1.5">
                            <span>{item.icon}</span>
                            <span>{item.label}</span>
                          </span>
                          <span className="font-bold text-slate-900 font-mono text-[11px]">
                            {assetData.available} / {assetData.total}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              pct < 30
                                ? "bg-red-600"
                                : pct < 60
                                ? "bg-amber-500"
                                : "bg-emerald-600"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>

      {showFleetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Fleet & Resource Management
                </h3>
                {fleetSavedMsg && (
                  <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded animate-fade-in">
                    ✓ Updated
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowFleetModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-xs text-slate-500">
                Adjust available and total operational units for real-time CAD dispatching.
              </div>

              <div className="space-y-3">
                {fleetAssets.map((asset) => {
                  const current = fleet[asset.key] || { available: 0, total: 1 };
                  const available = current.available;
                  const total = current.total;

                  return (
                    <div
                      key={asset.key}
                      className="p-3 bg-slate-50 rounded border border-slate-200 flex flex-col gap-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{asset.icon}</span>
                          <div>
                            <div className="text-xs font-bold text-slate-900">{asset.label}</div>
                            <div className="text-[10px] text-slate-500">
                              Available: <strong className="text-slate-800 font-mono">{available}</strong> / {total} units
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">
                            Available:
                          </span>
                          <button
                            onClick={() => updateFleetAsset(asset.key, available - 1)}
                            disabled={available <= 0}
                            className="w-7 h-7 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-sm flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition"
                            title="Decrease available units"
                          >
                            −
                          </button>
                          <span className="w-6 text-center font-mono font-bold text-xs text-slate-900">
                            {available}
                          </span>
                          <button
                            onClick={() => updateFleetAsset(asset.key, available + 1)}
                            disabled={available >= total}
                            className="w-7 h-7 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-sm flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition"
                            title="Increase available units"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-[11px] text-slate-500">
                        <span>Total Fleet Capacity:</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => updateFleetAsset(asset.key, Math.min(available, total - 1), total - 1)}
                            disabled={total <= 1}
                            className="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition"
                            title="Decrease total capacity"
                          >
                            −
                          </button>
                          <span className="w-6 text-center font-mono font-semibold text-xs text-slate-800">
                            {total}
                          </span>
                          <button
                            onClick={() => updateFleetAsset(asset.key, available, total + 1)}
                            className="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center transition"
                            title="Increase total capacity"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="text-[11px] text-slate-500 font-mono">
                {availableFleetUnits} / {totalFleetUnits} units ready ({deployedFleetUnits} deployed)
              </div>
              <button
                onClick={() => setShowFleetModal(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showAnalytics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Fleet & Incident Analytics
              </h3>
              <button
                onClick={() => setShowAnalytics(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 p-3 rounded border border-slate-200 text-center font-mono">
                  <div className="text-xl font-extrabold text-slate-900">{incidents.length}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">
                    Ingested
                  </div>
                </div>
                <div className="bg-slate-50 p-3 rounded border border-slate-200 text-center font-mono">
                  <div className="text-xl font-extrabold text-slate-900">{dispatchedCount}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">
                    Dispatched
                  </div>
                </div>
                <div className="bg-slate-50 p-3 rounded border border-slate-200 text-center font-mono">
                  <div className="text-xl font-extrabold text-slate-900">{resolvedCount}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">
                    Resolved
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2">
                  Priority Breakdown
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Critical", count: criticalCount, color: "bg-red-600" },
                    { label: "High", count: highCount, color: "bg-amber-500" },
                    { label: "Moderate", count: moderateCount, color: "bg-blue-600" },
                  ].map((p) => {
                    const pct =
                      incidents.length > 0
                        ? Math.round((p.count / incidents.length) * 100)
                        : 0;
                    return (
                      <div key={p.label}>
                        <div className="flex justify-between text-xs text-slate-600 mb-1">
                          <span className="font-medium">{p.label}</span>
                          <span className="font-mono text-slate-900">
                            {p.count} ({pct}%)
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${p.color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowAnalytics(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
