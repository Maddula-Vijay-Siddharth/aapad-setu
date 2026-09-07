"use client"

import { Droplets, Users, HeartPulse, Sparkles, CheckCircle2, ShieldCheck } from "lucide-react"
import { type Emergency, priorityMeta } from "@/lib/emergencies"

type RecommendationPanelProps = {
  emergency: Emergency | undefined
  onDispatch: (id: string) => void
}

export function RecommendationPanel({ emergency, onDispatch }: RecommendationPanelProps) {
  if (!emergency) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-slate-500">Select an emergency to see its details and AI recommendation.</p>
      </section>
    )
  }

  const meta = priorityMeta[emergency.priority]
  const isDispatched = emergency.status === "dispatched"

  const facts = [
    { icon: Droplets, label: "Water Depth", value: emergency.waterDepth, tint: "text-sky-600 bg-sky-50" },
    { icon: Users, label: "People Affected", value: `${emergency.peopleAffected} people`, tint: "text-indigo-600 bg-indigo-50" },
    { icon: HeartPulse, label: "Vulnerable Groups", value: emergency.vulnerableGroups, tint: "text-rose-600 bg-rose-50" },
  ]

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Incident Details &amp; AI Recommendation</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {emergency.location} · <span className="font-mono text-xs">{emergency.id}</span>
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badge}`}>
          <span aria-hidden="true">{meta.dot}</span>
          {meta.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${f.tint}`}>
              <f.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="mt-2 text-xs font-medium text-slate-500">{f.label}</p>
            <p className="text-sm font-semibold text-slate-900">{f.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Recommended Action
        </p>
        <p className="mt-1 text-lg font-bold text-slate-900">{emergency.recommendation.action}</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{emergency.recommendation.rationale}</p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-blue-200">
          <ShieldCheck className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
          Assigned team: {emergency.recommendation.team}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {isDispatched ? (
          <span className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            Team dispatched
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onDispatch(emergency.id)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200"
          >
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            Confirm &amp; Dispatch Team
          </button>
        )}
      </div>
    </section>
  )
}
