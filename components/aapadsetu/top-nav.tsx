import { LifeBuoy, Siren, Truck } from "lucide-react"

type TopNavProps = {
  activeCount: number
  dispatchedCount: number
}

export function TopNav({ activeCount, dispatchedCount }: TopNavProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <LifeBuoy className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="leading-tight">
            <p className="text-base font-bold text-slate-900">Aapad Setu Dashboard</p>
            <p className="text-xs text-slate-500">Disaster Response Coordination</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            <Siren className="h-4 w-4" aria-hidden="true" />
            {activeCount} Active
            <span className="hidden sm:inline">Emergencies</span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <Truck className="h-4 w-4" aria-hidden="true" />
            {dispatchedCount} Dispatched
          </span>
        </div>
      </div>
    </header>
  )
}
