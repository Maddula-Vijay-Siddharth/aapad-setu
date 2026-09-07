"use client"

import { useState } from "react"
import { Sparkles, Loader2, PhoneCall } from "lucide-react"

type ReportPanelProps = {
  onAnalyze: (message: string) => void
  isAnalyzing: boolean
}

export function ReportPanel({ onAnalyze, isAnalyzing }: ReportPanelProps) {
  const [message, setMessage] = useState("")

  function handleSubmit() {
    const trimmed = message.trim()
    if (!trimmed || isAnalyzing) return
    onAnalyze(trimmed)
    setMessage("")
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <PhoneCall className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-bold text-slate-900">Log Emergency Call</h2>
          <p className="text-xs text-slate-500">
            Type or paste what the caller told you — Aapad Setu handles the rest.
          </p>
        </div>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.metaKey || e.ctrlKey) &&
            !e.nativeEvent.isComposing &&
            e.keyCode !== 229
          ) {
            e.preventDefault()
            handleSubmit()
          }
        }}
        rows={5}
        placeholder="Type or paste the distress message here..."
        className="mt-4 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isAnalyzing || !message.trim()}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isAnalyzing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Analyzing report...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Analyze Report
          </>
        )}
      </button>

      <p className="mt-2 text-center text-xs text-slate-400">
        Tip: press{" "}
        <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
          Ctrl
        </kbd>{" "}
        +{" "}
        <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
          Enter
        </kbd>{" "}
        to analyze
      </p>
    </section>
  )
}
