"use client"

import { MapPin, Navigation } from "lucide-react"
import { type Emergency, priorityMeta } from "@/lib/emergencies"

type RescueMapProps = {
  emergencies: Emergency[]
  selectedId: string
  onSelect: (id: string) => void
}

const pinColor: Record<Emergency["priority"], string> = {
  critical: "bg-rose-500",
  high: "bg-amber-500",
  moderate: "bg-yellow-400",
}

export function RescueMap({ emergencies, selectedId, onSelect }: RescueMapProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Navigation className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">Live Rescue Map</h2>
            <p className="text-xs text-slate-500">Tap a pin to review the incident</p>
          </div>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:inline-flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          Live feed
        </span>
      </div>

      <div className="relative mt-4 min-h-[400px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {/* subtle grid so the placeholder reads like a map, not a blank box */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.18) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-slate-400"
        >
          <MapPin className="h-8 w-8" />
          <span className="mt-1 text-xs font-medium">Map view (Leaflet placeholder)</span>
        </div>

        {emergencies.map((e) => {
          const isSelected = e.id === selectedId
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onSelect(e.id)}
              aria-label={`Incident at ${e.location}, ${priorityMeta[e.priority].label} priority`}
              className="group absolute -translate-x-1/2 -translate-y-full focus:outline-none"
              style={{ top: `${e.map.top}%`, left: `${e.map.left}%` }}
            >
              <span
                className={`relative flex h-7 w-7 items-center justify-center rounded-full text-white shadow-md ring-2 ring-white transition group-hover:scale-110 ${
                  pinColor[e.priority]
                } ${isSelected ? "scale-125" : ""}`}
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {e.status === "active" && (
                  <span
                    className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${pinColor[e.priority]}`}
                  />
                )}
              </span>
              <span
                className={`mt-1 block max-w-[120px] truncate rounded-md bg-white px-1.5 py-0.5 text-center text-[11px] font-medium shadow-sm ${
                  isSelected ? "text-slate-900" : "text-slate-500"
                }`}
              >
                {e.location}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
