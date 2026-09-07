export type Priority = "critical" | "high" | "moderate"

export type Recommendation = {
  action: string
  rationale: string
  team: string
}

export type Emergency = {
  id: string
  location: string
  area: string
  priority: Priority
  summary: string
  peopleAffected: number
  waterDepth: string
  vulnerableGroups: string
  reportedAt: string
  status: "active" | "dispatched"
  recommendation: Recommendation
  // relative map position in %, keeps the placeholder map readable
  map: { top: number; left: number }
}

export const priorityMeta: Record<
  Priority,
  { label: string; dot: string; badge: string }
> = {
  critical: {
    label: "Critical",
    dot: "🔴",
    badge: "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200",
  },
  high: {
    label: "High",
    dot: "🟠",
    badge: "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200",
  },
  moderate: {
    label: "Moderate",
    dot: "🟡",
    badge: "bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-200",
  },
}

export const initialEmergencies: Emergency[] = [
  {
    id: "RESQ-4821",
    location: "Kuttanad Backwaters",
    area: "Alappuzha District",
    priority: "critical",
    summary: "4 people trapped on a rooftop as water keeps rising",
    peopleAffected: 4,
    waterDepth: "Above 2 m — rising",
    vulnerableGroups: "1 infant, 1 elderly",
    reportedAt: "2 min ago",
    status: "active",
    recommendation: {
      action: "Send NDRF Rescue Boat",
      rationale:
        "Deep, rising water with people stranded above ground level means a motorised boat with a trained swimmer is the safest option.",
      team: "NDRF Boat Team Alpha",
    },
    map: { top: 34, left: 42 },
  },
  {
    id: "RESQ-4820",
    location: "Chengannur Market Road",
    area: "Pathanamthitta District",
    priority: "high",
    summary: "Family of 6 needs evacuation before nightfall",
    peopleAffected: 6,
    waterDepth: "Around 1 m — steady",
    vulnerableGroups: "2 children",
    reportedAt: "11 min ago",
    status: "active",
    recommendation: {
      action: "Dispatch Ground Evacuation Van",
      rationale:
        "Water is shallow and stable, and the road is still passable, so a ground team can evacuate the family quickly.",
      team: "Volunteer Ground Team 3",
    },
    map: { top: 58, left: 63 },
  },
  {
    id: "RESQ-4816",
    location: "Aranmula Riverside",
    area: "Pathanamthitta District",
    priority: "moderate",
    summary: "Elderly resident needs medicine and a wellness check",
    peopleAffected: 1,
    waterDepth: "Ankle deep — receding",
    vulnerableGroups: "1 elderly (diabetic)",
    reportedAt: "26 min ago",
    status: "active",
    recommendation: {
      action: "Send Medical Supply Runner",
      rationale:
        "No immediate rescue risk, but insulin delivery is time-sensitive, so a fast supply runner is enough.",
      team: "Medical Support Team 2",
    },
    map: { top: 72, left: 30 },
  },
]
