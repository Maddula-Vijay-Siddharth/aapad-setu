"use client"

import { MapPin, Users, Clock, CheckCircle2 } from "lucide-react"
import { type Emergency, priorityMeta } from "@/lib/emergencies"

type EmergencyListProps = {
  emergencies: Emergency[]
  selectedId: string
  onSelect: (id: string) => void
}

export function EmergencyList({ emergencies, selectedId, onSelect }: EmergencyListProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">Active Emergencies</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
          {emergencies.length} open
        </span>
      </div>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        {emergencies.map((e) => {
          const meta = priorityMeta[e.priority]
          const isSelected = e.id === selectedId
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onSelect(e.id)}
              aria-pressed={isSelected}
              className={`w-full rounded-xl border bg-white p-4 text-left transition focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                isSelected
                  ? "border-blue-400 ring-2 ring-blue-100"
                  : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                    <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="truncate">{e.location}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{e.area}</p>
                </div>
                {e.status === "dispatched" ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Dispatched
                  </span>
                ) : (
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badge}`}
                  >
                    <span aria-hidden="true">{meta.dot}</span>
                    {meta.label}
                  </span>
                )}
              </div>

              <p className="mt-3 text-sm leading-relaxed text-slate-700">{e.summary}</p>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {e.peopleAffected} affected
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {e.reportedAt}
                </span>
                <span className="ml-auto font-mono text-[11px] text-slate-400">{e.id}</span>
              </div>
            </button>
          )
        })}

        {emergencies.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
            No open emergencies right now.
          </div>
        )}
      </div>
    </section>
  )
}
