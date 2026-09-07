"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import type { Incident, FleetInventory, PriorityTier, DispatchAsset, DispatchAction } from "@/lib/types";
import { DEFAULT_FLEET } from "@/lib/types";
import { supabase, isSupabaseConfigured, dbToIncident } from "@/lib/supabase";

type FilterMode = "all" | "Critical" | "High" | "Moderate" | "Active" | "Dispatched" | "Resolved";
type SortOption = "newest" | "oldest" | "urgency" | "priority" | "people" | "status";

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

function formatFullDateTime(ts?: string): string {
  if (!ts) return "N/A";
  const date = new Date(ts);
  if (isNaN(date.getTime())) return ts;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [fleet, setFleet] = useState<FleetInventory>({ ...DEFAULT_FLEET });
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(12);

  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmResolveId, setConfirmResolveId] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showFleetModal, setShowFleetModal] = useState(false);
  const [fleetSavedMsg, setFleetSavedMsg] = useState(false);

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
            return Array.from(map.values());
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
            return Array.from(map.values());
          });
        }
      } catch {}
    }

    loadDirectFromSupabase();
    refreshIncidents();
    fetchFleet();

    const interval = setInterval(() => {
      refreshIncidents();
      fetchFleet();
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshIncidents, fetchFleet]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    const channel = supabase
      .channel("incidents-realtime-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incidents" },
        async (payload) => {
          if (payload.eventType === "INSERT") {
            const { data } = await supabase
              .from("incidents")
              .select("*, incident_reports (*), dispatch_actions (*)")
              .eq("id", (payload.new as any).id)
              .single();
            if (data) {
              const newInc = dbToIncident(data);
              setIncidents((prev) => {
                const next = [newInc, ...prev.filter((i) => i.id !== newInc.id)];
                return next;
              });
            }
          } else if (payload.eventType === "UPDATE") {
            const { data } = await supabase
              .from("incidents")
              .select("*, incident_reports (*), dispatch_actions (*)")
              .eq("id", (payload.new as any).id)
              .single();
            if (data) {
              const updated = dbToIncident(data);
              setIncidents((prev) =>
                prev.map((i) => (i.id === updated.id ? updated : i))
              );
              setSelectedIncident((prev) =>
                prev && prev.id === updated.id ? updated : prev
              );
            }
          } else if (payload.eventType === "DELETE") {
            const deletedId = (payload.old as any).id;
            setIncidents((prev) => prev.filter((i) => i.id !== deletedId));
            setSelectedIncident((prev) => (prev && prev.id === deletedId ? null : prev));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dispatch_actions" },
        () => {
          refreshIncidents();
          fetchFleet();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fleet_inventory" },
        () => {
          fetchFleet();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshIncidents, fetchFleet]);

  useEffect(() => {
    if (selectedIncident) {
      const match = incidents.find((i) => i.id === selectedIncident.id);
      if (match && (match.status !== selectedIncident.status || match.dispatchActions?.length !== selectedIncident.dispatchActions?.length)) {
        setSelectedIncident(match);
      }
    }
  }, [incidents, selectedIncident]);

  useEffect(() => {
    setSelectedQuantities({});
    setConfirmResolveId(null);
  }, [selectedIncident?.id]);

  const dispatchOptions: { key: DispatchAsset; label: string }[] = useMemo(
    () => [
      { key: "NDRF Rescue Boat", label: "NDRF Rescue Boat" },
      { key: "ALS Ambulance", label: "ALS Ambulance" },
      { key: "Drone Ration Drop", label: "Drone Recon Unit" },
      { key: "SDRF Rescue Truck", label: "SDRF Rescue Truck" },
    ],
    []
  );

  const fleetAssets: { key: DispatchAsset; label: string; icon: string }[] = [
    { key: "NDRF Rescue Boat", label: "NDRF Rescue Boats", icon: "🚤" },
    { key: "ALS Ambulance", label: "ALS Ambulances", icon: "🚑" },
    { key: "Drone Ration Drop", label: "Drone Recon Units", icon: "🛸" },
    { key: "SDRF Rescue Truck", label: "SDRF Rescue Trucks", icon: "🚒" },
  ];

  const totalFleetUnits = fleetAssets.reduce((sum, a) => sum + (fleet[a.key]?.total || 0), 0);
  const availableFleetUnits = fleetAssets.reduce((sum, a) => sum + (fleet[a.key]?.available || 0), 0);
  const deployedFleetUnits = totalFleetUnits - availableFleetUnits;

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

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      if (filter === "Active" && incident.status === "Resolved") return false;
      if (filter === "Dispatched" && incident.status !== "Dispatched") return false;
      if (filter === "Resolved" && incident.status !== "Resolved") return false;
      if (filter === "Critical" && incident.priorityTier !== "Critical") return false;
      if (filter === "High" && incident.priorityTier !== "High") return false;
      if (filter === "Moderate" && incident.priorityTier !== "Moderate") return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const typeMatch = (incident.emergencyType || "").toLowerCase().includes(query);
        const locMatch = (incident.locationName || incident.landmark || "").toLowerCase().includes(query);
        const callerNameMatch = (incident.caller?.name || "").toLowerCase().includes(query);
        const callerPhoneMatch = (incident.caller?.phone || "").toLowerCase().includes(query);
        const textMatch = (incident.rawText || "").toLowerCase().includes(query);
        const idMatch = (incident.id || "").toLowerCase().includes(query);

        if (!typeMatch && !locMatch && !callerNameMatch && !callerPhoneMatch && !textMatch && !idMatch) {
          return false;
        }
      }
      return true;
    });
  }, [incidents, filter, searchQuery]);

  const sortedIncidents = useMemo(() => {
    const list = [...filteredIncidents];
    const pScore = (p: PriorityTier) => (p === "Critical" ? 4 : p === "High" ? 3 : p === "Moderate" ? 2 : 1);
    const sScore = (s: string) => (s === "Pending" ? 1 : s === "Dispatched" ? 2 : 3);

    list.sort((a, b) => {
      if (sortBy === "newest") {
        return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
      }
      if (sortBy === "oldest") {
        return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
      }
      if (sortBy === "urgency") {
        return (b.urgencyScore || 0) - (a.urgencyScore || 0);
      }
      if (sortBy === "priority") {
        return pScore(b.priorityTier) - pScore(a.priorityTier);
      }
      if (sortBy === "people") {
        return (b.peopleCount || 1) - (a.peopleCount || 1);
      }
      if (sortBy === "status") {
        return sScore(a.status) - sScore(b.status);
      }
      return 0;
    });
    return list;
  }, [filteredIncidents, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sortedIncidents.length / pageSize));
  const paginatedIncidents = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedIncidents.slice(start, start + pageSize);
  }, [sortedIncidents, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, searchQuery, sortBy]);

  const totalIncidentsCount = incidents.length;
  const activeIncidentsCount = incidents.filter((i) => i.status !== "Resolved").length;
  const dispatchedCount = incidents.filter((i) => i.status === "Dispatched").length;
  const resolvedCount = incidents.filter((i) => i.status === "Resolved").length;
  const criticalCount = incidents.filter((i) => i.priorityTier === "Critical").length;
  const highCount = incidents.filter((i) => i.priorityTier === "High").length;
  const moderateCount = incidents.filter((i) => i.priorityTier === "Moderate").length;

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
            <Link
              href="/"
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span>Map View</span>
            </Link>

            <Link
              href="/incidents"
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 transition"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Incidents</span>
              </div>
              <span className="text-[10px] font-mono font-bold bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded">
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
              Readiness
            </div>
            <div className="px-2 py-1 flex items-center justify-between text-xs text-slate-600">
              <span>NDRF Water Rescue</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div className="px-2 py-1 flex items-center justify-between text-xs text-slate-600">
              <span>SDRF Tactical Ops</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div className="px-2 py-1 flex items-center justify-between text-xs text-slate-600">
              <span>Medical Units</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div className="px-2 py-1 flex items-center justify-between text-xs text-slate-600">
              <span>Drone Recon Squad</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
          </div>
        </div>

        <div className="px-2 py-2 border-t border-slate-100 space-y-2">
          <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between">
            <span>CAD SERVER</span>
            <span className="text-emerald-600 font-bold">CONNECTED</span>
          </div>
          <div className="text-[10px] text-slate-500">
            Realtime DB & CAD sync operational.
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 px-5 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <div className="relative w-full">
              <input
                type="text"
                placeholder="Search incidents by location, caller, emergency type, ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:border-blue-500 transition text-slate-800 placeholder:text-slate-400"
              />
              <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                All Incidents
              </h1>
              <div className="text-[11px] text-slate-400 font-mono">
                Last synced: Just now • Live CAD Feed
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Detailed view of all reported emergency incidents and their current response status.
            </p>
          </div>

          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            <div className="bg-white border border-slate-200 rounded-md p-3.5 shadow-2xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Total Incidents
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-2xl font-black text-slate-900 font-mono">
                  {totalIncidentsCount}
                </div>
                <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded font-mono">
                  All time
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Verified CAD records
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3.5 shadow-2xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Active Incidents
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-2xl font-black text-blue-600 font-mono">
                  {activeIncidentsCount}
                </div>
                <span className="text-[10px] font-medium text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded font-mono">
                  In progress
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Pending & dispatched
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3.5 shadow-2xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Dispatched
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-2xl font-black text-indigo-600 font-mono">
                  {dispatchedCount}
                </div>
                <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded font-mono">
                  En route
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Active resource deploy
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3.5 shadow-2xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Resolved
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-2xl font-black text-emerald-600 font-mono">
                  {resolvedCount}
                </div>
                <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-mono">
                  Cleared
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Units returned to pool
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3.5 shadow-2xs col-span-2 sm:col-span-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Critical Priority
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-2xl font-black text-red-600 font-mono">
                  {criticalCount}
                </div>
                <span className="text-[10px] font-medium text-red-700 bg-red-50 px-1.5 py-0.2 rounded font-mono font-bold">
                  High danger
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Immediate intervention
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-md shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white">
              <div className="flex items-center gap-1.5 flex-wrap">
                {(["all", "Critical", "High", "Moderate", "Active", "Dispatched", "Resolved"] as FilterMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setFilter(mode)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                      filter === mode
                        ? "bg-slate-900 text-white shadow-2xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {mode === "all" ? "All Incidents" : mode}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">Sort by:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="text-xs font-medium text-slate-900 bg-slate-50 border border-slate-200 rounded px-2.5 py-1 focus:outline-none focus:border-blue-500 transition"
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="urgency">Highest Urgency</option>
                    <option value="priority">Highest Priority</option>
                    <option value="people">Most People Affected</option>
                    <option value="status">Status</option>
                  </select>
                </div>

                <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                  Showing {paginatedIncidents.length} of {sortedIncidents.length}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[950px]">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500 select-none">
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4">Incident</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4 text-center">People</th>
                    <th className="py-3 px-4">Caller</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Urgency</th>
                    <th className="py-3 px-4">Reported</th>
                    <th className="py-3 px-4">Dispatch</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {paginatedIncidents.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400">
                        <div className="max-w-xs mx-auto space-y-2">
                          <div className="text-sm font-medium text-slate-600">No matching incidents found</div>
                          <p className="text-xs text-slate-400">Try adjusting your filters or search query.</p>
                          {(searchQuery || filter !== "all") && (
                            <button
                              onClick={() => {
                                setSearchQuery("");
                                setFilter("all");
                              }}
                              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold transition mt-2"
                            >
                              Reset Filters
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedIncidents.map((incident) => {
                      const isCritical = incident.priorityTier === "Critical";
                      const isHigh = incident.priorityTier === "High";
                      const isModerate = incident.priorityTier === "Moderate";

                      return (
                        <tr
                          key={incident.id}
                          className="hover:bg-blue-50/30 transition cursor-pointer"
                          onClick={() => setSelectedIncident(incident)}
                        >
                          <td className="py-3 px-4 font-mono whitespace-nowrap">
                            <span
                              className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded ${
                                isCritical
                                  ? "bg-red-100 text-red-700 border border-red-200"
                                  : isHigh
                                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                                  : isModerate
                                  ? "bg-blue-100 text-blue-700 border border-blue-200"
                                  : "bg-slate-100 text-slate-600 border border-slate-200"
                              }`}
                            >
                              {incident.priorityTier}
                            </span>
                          </td>

                          <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span>{incident.emergencyType || "Emergency"}</span>
                              {incident.channel && (
                                <span className="text-[9px] font-mono text-slate-400 border border-slate-200 px-1 rounded">
                                  {incident.channel}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 max-w-xs truncate">
                            <div className="font-medium text-slate-800 truncate">
                              {incident.locationName || "Secunderabad Grid"}
                            </div>
                            {incident.landmark && (
                              <div className="text-[10px] text-slate-400 truncate">
                                Near {incident.landmark}
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                            {incident.peopleCount ?? 1}
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-medium text-slate-800">
                              {incident.caller?.name || "Unknown"}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {incident.caller?.phone || "No phone"}
                            </div>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium font-mono ${
                                incident.status === "Dispatched"
                                  ? "bg-blue-50 text-blue-700 font-semibold"
                                  : incident.status === "Resolved"
                                  ? "bg-emerald-50 text-emerald-700 font-semibold"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  incident.status === "Dispatched"
                                    ? "bg-blue-600 animate-pulse"
                                    : incident.status === "Resolved"
                                    ? "bg-emerald-600"
                                    : "bg-slate-400"
                                }`}
                              />
                              <span>{incident.status || "Pending"}</span>
                            </span>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900 w-7">
                                {incident.urgencyScore}
                              </span>
                              <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    incident.urgencyScore >= 75
                                      ? "bg-red-600"
                                      : incident.urgencyScore >= 50
                                      ? "bg-amber-500"
                                      : "bg-blue-600"
                                  }`}
                                  style={{ width: `${incident.urgencyScore}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                            {formatIncidentTime(incident.timestamp)}
                          </td>

                          <td className="py-3 px-4 max-w-xs truncate text-[11px] font-medium text-slate-700">
                            {getDispatchedAsset(incident)}
                          </td>

                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedIncident(incident);
                              }}
                              className="px-2.5 py-1 rounded bg-slate-100 hover:bg-blue-50 hover:text-blue-700 font-medium text-xs text-slate-700 transition"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between text-xs text-slate-600">
                <span className="font-mono">
                  Page {currentPage} of {totalPages} ({sortedIncidents.length} total)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white transition"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>

      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setSelectedIncident(null)}
          />

          <div className="relative w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col z-10 overflow-hidden animate-slide-in">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                    {selectedIncident.emergencyType || "Emergency Incident"}
                  </h2>
                  <span
                    className={`inline-block px-2 py-0.2 text-[10px] font-bold uppercase tracking-wider rounded ${
                      selectedIncident.priorityTier === "Critical"
                        ? "bg-red-100 text-red-700"
                        : selectedIncident.priorityTier === "High"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {selectedIncident.priorityTier}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  ID: #{selectedIncident.id}
                </div>
              </div>

              <button
                onClick={() => setSelectedIncident(null)}
                className="w-7 h-7 rounded-md hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 text-sm font-bold transition"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Incident Status Timeline
                </div>

                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div className="space-y-1">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto text-xs font-bold">
                      ✓
                    </div>
                    <div className="font-semibold text-slate-800 text-[11px]">Reported</div>
                    <div className="text-[9px] text-slate-400 font-mono">
                      {formatIncidentTime(selectedIncident.timestamp)}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto text-xs font-bold">
                      ✓
                    </div>
                    <div className="font-semibold text-slate-800 text-[11px]">AI Triaged</div>
                    <div className="text-[9px] text-slate-400 font-mono">Score {selectedIncident.urgencyScore}</div>
                  </div>

                  <div className="space-y-1">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center mx-auto text-xs font-bold ${
                        selectedIncident.status === "Dispatched" || selectedIncident.status === "Resolved"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      {selectedIncident.status === "Resolved" ? "✓" : "3"}
                    </div>
                    <div className="font-semibold text-slate-800 text-[11px]">Dispatched</div>
                    <div className="text-[9px] text-slate-400 font-mono">
                      {selectedIncident.status === "Pending" ? "Pending" : "Active"}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center mx-auto text-xs font-bold ${
                        selectedIncident.status === "Resolved"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      {selectedIncident.status === "Resolved" ? "✓" : "4"}
                    </div>
                    <div className="font-semibold text-slate-800 text-[11px]">Resolved</div>
                    <div className="text-[9px] text-slate-400 font-mono">
                      {selectedIncident.status === "Resolved" ? "Completed" : "Standby"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-white rounded border border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Location
                  </span>
                  <div className="font-semibold text-xs text-slate-900 mt-1">
                    {selectedIncident.locationName}
                  </div>
                  {selectedIncident.landmark && (
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Landmark: {selectedIncident.landmark}
                    </div>
                  )}
                </div>

                <div className="p-3 bg-white rounded border border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    People Affected
                  </span>
                  <div className="font-bold text-lg text-slate-900 mt-0.5 font-mono">
                    {selectedIncident.peopleCount ?? 1}
                  </div>
                  <div className="text-[10px] text-slate-400">Directly stranded</div>
                </div>

                <div className="p-3 bg-white rounded border border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Caller Information
                  </span>
                  <div className="font-semibold text-xs text-slate-900 mt-1">
                    {selectedIncident.caller?.name || "Unknown Caller"}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {selectedIncident.caller?.phone || "No phone recorded"}
                  </div>
                </div>

                <div className="p-3 bg-white rounded border border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    GPS Coordinates
                  </span>
                  <div className="font-mono text-xs text-slate-800 mt-1">
                    {selectedIncident.coordinates
                      ? `${selectedIncident.coordinates.lat.toFixed(5)}, ${selectedIncident.coordinates.lng.toFixed(5)}`
                      : "No GPS reported"}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Assigned: {selectedIncident.agencyTag}
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200/80 space-y-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  AI RECOMMENDATION
                </span>
                <div className="space-y-1.5 bg-white p-3 rounded border border-slate-200">
                  {getRecommendedList(selectedIncident).map((item, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <span className="text-blue-600 font-bold">✓</span>
                      <span>{item.resource}</span>
                      <span className="text-slate-500 font-mono text-[11px]">× {item.quantity}</span>
                    </div>
                  ))}
                  {selectedIncident.reasoning && (
                    <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 leading-relaxed">
                      {selectedIncident.reasoning}
                    </p>
                  )}
                </div>
              </div>

              {selectedIncident.status === "Pending" && (
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      DISPATCH RESOURCES
                    </div>
                    <div className="text-xs font-medium text-slate-500">
                      Total: <strong className="text-slate-900 font-mono">{totalSelectedUnits}</strong>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {dispatchOptions.map((opt) => {
                      const avail = fleet[opt.key]?.available || 0;
                      const isChecked = (selectedQuantities[opt.key] || 0) > 0;
                      const qty = selectedQuantities[opt.key] || 0;
                      const isDisabled = avail <= 0;

                      return (
                        <div
                          key={opt.key}
                          className={`p-2 rounded border transition flex items-center justify-between gap-2 ${
                            isDisabled
                              ? "bg-slate-100 border-slate-200 opacity-60"
                              : isChecked
                              ? "bg-blue-50/70 border-blue-300 ring-1 ring-blue-300"
                              : "bg-white border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <label className="flex items-center gap-2 cursor-pointer select-none min-w-0 flex-1">
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
                            <div className="flex items-center gap-1 shrink-0 bg-white border border-slate-200 rounded px-1 py-0.5 shadow-2xs">
                              <button
                                type="button"
                                onClick={() => updateResourceQuantity(opt.key, -1)}
                                disabled={qty <= 1}
                                className="w-5 h-5 flex items-center justify-center rounded text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                              >
                                −
                              </button>
                              <span className="w-4 text-center text-xs font-bold font-mono text-slate-900">
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateResourceQuantity(opt.key, 1)}
                                disabled={qty >= avail}
                                className="w-5 h-5 flex items-center justify-center rounded text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={() => handleDispatchResources(selectedIncident)}
                      disabled={actionLoading || totalSelectedUnits === 0}
                      className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition disabled:opacity-50"
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
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200/80 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
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
                    </div>

                    <div>
                      {confirmResolveId === selectedIncident.id ? (
                        <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded">
                          <span className="text-xs font-medium text-emerald-900">
                            Mark incident resolved?
                          </span>
                          <button
                            onClick={() => handleResolveIncident(selectedIncident)}
                            disabled={actionLoading}
                            className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded transition disabled:opacity-50"
                          >
                            Complete
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
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200/80 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    DISPATCHED RESOURCES (RESOLVED)
                  </span>
                  <div className="space-y-1 bg-white p-3 rounded border border-slate-200">
                    {getDispatchedList(selectedIncident).map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                        <span>{item.assetName}</span>
                        <span className="font-mono text-slate-500">× {item.quantity}</span>
                      </div>
                    ))}
                    <div className="text-[10px] text-emerald-600 font-medium pt-1.5 border-t border-slate-100 flex items-center gap-1">
                      <span>✓</span>
                      <span>Incident Resolved & Units Returned to Fleet</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="text-[10px] text-slate-400 font-mono pt-2 border-t border-slate-100">
                Created: {formatFullDateTime(selectedIncident.timestamp)}
              </div>
            </div>
          </div>
        </div>
      )}

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
