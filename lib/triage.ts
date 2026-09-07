import OpenAI from "openai";
import type { Incident, PriorityTier, DispatchAsset, AgencyTag, Coordinates, CallerContact, RecommendedDispatchItem } from "./types";

const MODEL = "deepseek-ai/DeepSeek-V3-0324";

const HYDERABAD_ANCHORS: { name: string; lat: number; lng: number }[] = [
  { name: "Secunderabad Railway Station", lat: 17.4344, lng: 78.5013 },
  { name: "Hussain Sagar Lake", lat: 17.4239, lng: 78.4738 },
  { name: "Malkajgiri", lat: 17.4530, lng: 78.5275 },
  { name: "Begumpet", lat: 17.4437, lng: 78.4673 },
  { name: "Ameerpet", lat: 17.4375, lng: 78.4483 },
  { name: "Kukatpally", lat: 17.4849, lng: 78.3996 },
  { name: "LB Nagar", lat: 17.3457, lng: 78.5522 },
  { name: "Charminar", lat: 17.3616, lng: 78.4747 },
  { name: "Hitech City", lat: 17.4435, lng: 78.3772 },
  { name: "Dilsukhnagar", lat: 17.3688, lng: 78.5247 },
];

const SYSTEM_PROMPT = `You are AapadSetu-TRIAGE, an autonomous disaster incident evaluation engine deployed during active flood, cyclone, and earthquake emergencies in the Hyderabad / Secunderabad / Telangana region.

You are NOT a chatbot. You receive raw distress text (possibly in Telugu, Hindi, Hinglish, or compressed SMS format) and return ONLY a single JSON object. No markdown. No backticks. No explanation outside the JSON.

TASK:
1. EXTRACT from the distress text:
   - locationName: best human-readable location
   - coordinates: { "lat": number, "lng": number } — geocode from place names. If vague, use Secunderabad area (~17.43, ~78.50) with slight offset.
   - waterLevelFeet: water depth in feet (0 if not mentioned)
   - peopleCount: number of people (default 1)
   - vulnerableGroups: array from ["elderly","children","infants","pregnant","disabled","injured","chronic_illness"] (empty if none)

2. CALCULATE urgencyScore (1-100):
   - 85-100: imminent drowning, structural collapse, acute medical emergency
   - 70-84: rising water + vulnerable groups + no rescue
   - 40-69: stranded but stable
   - 1-39: property-only, already evacuated, or "mark safe" messages

3. DERIVE priorityTier:
   - 85-100 → "Critical"
   - 70-84  → "High"
   - 40-69  → "Moderate"
   - 1-39   → "Low"

4. RECOMMEND dispatch assets:
   - "recommendedDispatch": the primary dispatch asset ("NDRF Rescue Boat" | "ALS Ambulance" | "Drone Ration Drop" | "SDRF Rescue Truck" | "Standby / Monitor")
   - "recommendedDispatches": array of 1 to 3 recommended resources with quantities tailored to the scenario (e.g. flood + injured -> [{"resource": "NDRF Rescue Boat", "quantity": 1}, {"resource": "ALS Ambulance", "quantity": 1}]). Allowed resources: "NDRF Rescue Boat", "ALS Ambulance", "Drone Recon Unit", "SDRF Rescue Truck".

5. ASSIGN agencyTag:
   - "NDRF": national-level water rescue
   - "SDRF": state-level vehicle rescue
   - "FIRE": structural collapse, fire, confined space
   - "MEDICAL": medical emergencies, ambulance calls

6. GENERATE reasoningSteps: an array of 4-5 strings describing your sequential analysis steps, e.g.:
   ["Step 1: Entity parsing — extracted location 'Malkajgiri underpass', identified Telugu dialect with Hinglish loanwords",
    "Step 2: Geospatial anchoring — mapped 'Malkajgiri underpass' to coordinates 17.453, 78.527",
    "Step 3: Threat vector analysis — water depth 6ft with infant present escalates to imminent drowning risk",
    "Step 4: Urgency score calculation — base 60 + water(+25) + infant(+10) = 95 → CRITICAL tier",
    "Step 5: Tactical asset allocation — deep water + rooftop scenario → NDRF Rescue Boat, agency: NDRF"]

7. WRITE a concise "reasoning" (2-3 sentences).

8. DETECT "mark safe" or "cancel SOS" intent: If the message indicates the caller is safe or rescued, set urgencyScore to 5, priorityTier to "Low", recommendedDispatch to "Standby / Monitor", and note in reasoning that this is a safe-mark ping.

OUTPUT (strict JSON, nothing else):
{
  "locationName": "string",
  "coordinates": { "lat": number, "lng": number },
  "waterLevelFeet": number,
  "peopleCount": number,
  "vulnerableGroups": ["string"],
  "urgencyScore": number,
  "priorityTier": "Critical" | "High" | "Moderate" | "Low",
  "recommendedDispatch": "NDRF Rescue Boat" | "ALS Ambulance" | "Drone Ration Drop" | "SDRF Rescue Truck" | "Standby / Monitor",
  "recommendedDispatches": [
    { "resource": "string", "quantity": number, "reason": "string" }
  ],
  "agencyTag": "NDRF" | "SDRF" | "FIRE" | "MEDICAL",
  "reasoningSteps": ["string"],
  "reasoning": "string"
}`;

export function extractJsonObject(raw: string): Record<string, unknown> {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }
  return JSON.parse(cleaned);
}

export const VALID_DISPATCH: DispatchAsset[] = [
  "NDRF Rescue Boat", "ALS Ambulance", "Drone Ration Drop", "SDRF Rescue Truck", "Standby / Monitor",
];
export const VALID_AGENCY: AgencyTag[] = ["NDRF", "SDRF", "FIRE", "MEDICAL"];

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function deriveTier(score: number): PriorityTier {
  if (score >= 85) return "Critical";
  if (score >= 70) return "High";
  if (score >= 40) return "Moderate";
  return "Low";
}

export function deriveDispatch(score: number, text: string): DispatchAsset {
  const lower = text.toLowerCase();
  if (/medical|injured|pregnant|heart|breathing|bleed|fracture|asthma|ambulance/.test(lower)) return "ALS Ambulance";
  if (score >= 80 && /water|flood|drown|rooftop|roof|submerge|boat/.test(lower)) return "NDRF Rescue Boat";
  if (/cut off|inaccessible|no road|supplies|food|ration/.test(lower)) return "Drone Ration Drop";
  if (/safe|rescued|cancel|no longer/.test(lower)) return "Standby / Monitor";
  if (score >= 50) return "SDRF Rescue Truck";
  return "Standby / Monitor";
}

export function deriveAgency(dispatch: DispatchAsset): AgencyTag {
  if (dispatch === "NDRF Rescue Boat") return "NDRF";
  if (dispatch === "ALS Ambulance") return "MEDICAL";
  if (dispatch === "SDRF Rescue Truck") return "SDRF";
  if (dispatch === "Drone Ration Drop") return "NDRF";
  return "SDRF";
}

export function deriveMultiDispatches(
  score: number,
  text: string,
  primaryDispatch: DispatchAsset,
  peopleCount: number = 1
): RecommendedDispatchItem[] {
  const lower = text.toLowerCase();
  const results: RecommendedDispatchItem[] = [];

  const isSafe = /safe|rescued|cancel|no longer|all clear/.test(lower);
  if (isSafe) {
    return [{ resource: "Standby / Monitor", quantity: 1, reason: "Caller reporting safe / resolved" }];
  }

  const isFlood = /water|flood|drown|rooftop|roof|submerge|boat|lake|overflow|river/.test(lower) || score >= 75;
  const isMedical = /medical|injured|pregnant|heart|breathing|bleed|fracture|asthma|ambulance|hospital|casualty/.test(lower);
  const isTrapped = /rooftop|roof|trapped|stranded|isolated|surrounded|cut off/.test(lower);
  const isRoadAccessible = /road|street|highway|underpass|vehicle|truck|colony|lane/.test(lower);
  const needsSupplies = /supplies|ration|rations|food|airdrop|aerial|recon/.test(lower);

  if (isFlood && isMedical) {
    const boatCount = Math.max(1, Math.min(3, Math.ceil(peopleCount / 4)));
    results.push({ resource: "NDRF Rescue Boat", quantity: boatCount, reason: "Flood water evacuation" });
    results.push({ resource: "ALS Ambulance", quantity: 1, reason: "Medical triage & critical care" });
  } else if (isFlood && isTrapped) {
    const boatCount = Math.max(1, Math.min(3, Math.ceil(peopleCount / 4)));
    results.push({ resource: "NDRF Rescue Boat", quantity: boatCount, reason: "Rooftop extraction" });
    results.push({ resource: "Drone Recon Unit", quantity: 1, reason: "Aerial thermal recon & perimeter search" });
  } else if (isRoadAccessible && isMedical) {
    results.push({ resource: "SDRF Rescue Truck", quantity: 1, reason: "Road access clearance" });
    results.push({ resource: "ALS Ambulance", quantity: 1, reason: "Medical care & transport" });
  } else if (needsSupplies) {
    results.push({ resource: "Drone Recon Unit", quantity: 1, reason: "Supply drop & damage assessment" });
  } else {
    const name = primaryDispatch === "Drone Ration Drop" ? "Drone Recon Unit" : primaryDispatch;
    results.push({ resource: name, quantity: 1, reason: "Tactical response allocation" });
  }

  return results;
}

export function euclideanDist(a: Coordinates, b: Coordinates): number {
  const dLat = a.lat - b.lat;
  const dLng = a.lng - b.lng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function extractCaller(message: string): CallerContact {
  const phoneMatch = message.match(/(?:\+91[\s-]?)?(?:0)?([6-9]\d{9})\b/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[\s-]/g, "") : undefined;

  let name: string | undefined = undefined;
  const namePatterns = [
    /(?:contact|name|from|caller|reporting|this is|i am|i'm)\s*:?\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i,
    /(?:^|\.\s*)([A-Z][a-z]{2,})\s+(?:here|speaking|calling)/i,
    /CALLER:(\S+)/i,
  ];
  for (const pattern of namePatterns) {
    const m = message.match(pattern);
    if (m) {
      const candidate = m[1].trim();
      if (!/^(not provided|not available|unknown|none)$/i.test(candidate)) {
        name = candidate;
      }
      break;
    }
  }

  let hash = 0;
  const seed = message + (phone || "") + Date.now().toString();
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const verificationCode = String(Math.abs(hash) % 10000).padStart(4, "0");

  return { name, phone, verificationCode };
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((t) => t.length > 2)
  );
}

export function tokenSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) { if (setB.has(token)) intersection++; }
  return intersection / Math.min(setA.size, setB.size);
}

export function findDuplicate(coords: Coordinates, locationName: string, existing: Incident[]): Incident | undefined {
  for (const inc of existing) {
    if (inc.status === "Resolved") continue;
    const dist = euclideanDist(coords, inc.coordinates);
    const sim = tokenSimilarity(locationName, inc.locationName);
    if (dist < 0.002 || (dist < 0.006 && sim >= 0.25)) return inc;
  }
  return undefined;
}

export function heuristicFallback(
  message: string,
  hintCoords?: Coordinates | null,
  hintLocation?: string | null
): Omit<Incident, "id" | "rawText" | "status" | "timestamp" | "isDuplicateOf" | "caller" | "mergedReportsCount" | "operationalNotes" | "auditLog"> {
  const lower = message.toLowerCase();
  const isSafe = /safe|rescued|cancel|no longer|all clear/.test(lower);

  const smsMatch = message.match(/^SOS#([^#]+)#/i);
  const smsP = message.match(/P:(\d+)/i);
  const smsWater = message.match(/WATER:(\d+(?:\.\d+)?)FT/i);

  const numberMatches = message.match(/\b(\d+)\s*(?:people|persons|families|members|kids|children|trapped|stranded|log\b|phase)/i);
  const peopleCount = smsP ? parseInt(smsP[1], 10) : (numberMatches ? Math.max(1, parseInt(numberMatches[1], 10)) : 1);

  const waterMatch = smsWater || message.match(/(\d+(?:\.\d+)?)\s*(?:feet|ft|foot)\s*(?:of\s+)?(?:water|flood|depth)?/i);
  const waterLevelFeet = waterMatch ? parseFloat(waterMatch[1]) : 0;

  const vulnerableGroups: string[] = [];
  if (/elderly|old\s*(?:age|man|woman|people)|senior|uncle|amma/i.test(lower)) vulnerableGroups.push("elderly");
  if (/child|children|kids|baby|babies|toddler/i.test(lower)) vulnerableGroups.push("children");
  if (/infant|newborn|INFANT/i.test(message)) vulnerableGroups.push("infants");
  if (/pregnant|expecting|labor/i.test(lower)) vulnerableGroups.push("pregnant");
  if (/disabled|wheelchair/i.test(lower)) vulnerableGroups.push("disabled");
  if (/injur|bleed|fracture|broken|wound/i.test(lower)) vulnerableGroups.push("injured");
  if (/asthma|chronic|heart|diabetes|dialysis/i.test(lower)) vulnerableGroups.push("chronic_illness");

  let urgencyScore = isSafe ? 5 : 45;
  if (!isSafe) {
    if (waterLevelFeet > 4) urgencyScore += 25;
    else if (waterLevelFeet > 0) urgencyScore += 10;
    if (peopleCount > 5) urgencyScore += 15;
    else if (peopleCount > 1) urgencyScore += 5;
    if (vulnerableGroups.length > 0) urgencyScore += 10;
    if (/drown|collapse|trapped|critical|dying|emergency|sos|help.*urgent/i.test(lower)) urgencyScore += 15;
  }
  urgencyScore = clamp(urgencyScore, 1, 100);

  let coords: Coordinates;
  if (hintCoords && typeof hintCoords.lat === "number" && typeof hintCoords.lng === "number" && !isNaN(hintCoords.lat) && !isNaN(hintCoords.lng)) {
    coords = { lat: hintCoords.lat, lng: hintCoords.lng };
  } else {
    const anchor = HYDERABAD_ANCHORS[Math.floor(Math.random() * HYDERABAD_ANCHORS.length)];
    const jLat = (Math.random() - 0.5) * 0.02;
    const jLng = (Math.random() - 0.5) * 0.02;
    coords = { lat: parseFloat((anchor.lat + jLat).toFixed(4)), lng: parseFloat((anchor.lng + jLng).toFixed(4)) };
  }

  let locationName = hintLocation || (smsMatch ? smsMatch[1].replace(/-/g, " ") : "Disaster Zone");
  if (!hintLocation && !smsMatch) {
    const locPatterns = [
      /(?:at|in|near|from)\s+([A-Z][a-zA-Z\s]{2,30})/,
      /([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,3})\s+(?:area|colony|nagar|bagh|pet|guda|palli|abad|underpass|station)/i,
    ];
    for (const p of locPatterns) {
      const m = message.match(p);
      if (m) { locationName = m[1].trim(); break; }
    }
  }

  const recommendedDispatch = isSafe ? "Standby / Monitor" as DispatchAsset : deriveDispatch(urgencyScore, message);
  const recommendedDispatches = deriveMultiDispatches(urgencyScore, message, recommendedDispatch, peopleCount);
  const agencyTag = deriveAgency(recommendedDispatch);
  const priorityTier = deriveTier(urgencyScore);

  const reasoningSteps = [
    `Step 1: Entity parsing — extracted location '${locationName}', detected ${/telugu|amma|vachindi|pampandi|unnaaru/i.test(message) ? "Telugu dialect" : /bhejo|phase|raha/i.test(lower) ? "Hindi/Hinglish dialect" : /^SOS#/i.test(message) ? "compressed SMS protocol" : /^EMERGENCY REPORT/i.test(message) ? "Receiver MMS/SMS report" : "English"} input`,
    `Step 2: Geospatial anchoring — mapped '${locationName}' to coordinates ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
    `Step 3: Threat vector analysis — water depth ${waterLevelFeet}ft, ${peopleCount} person(s), ${vulnerableGroups.length > 0 ? "vulnerable: " + vulnerableGroups.join(", ") : "no vulnerable groups flagged"}`,
    `Step 4: Urgency score calculation — computed score ${urgencyScore} → ${priorityTier} tier`,
    `Step 5: Tactical asset allocation — ${recommendedDispatch}, agency: [${agencyTag}]`,
  ];

  return {
    locationName,
    coordinates: coords,
    waterLevelFeet,
    peopleCount,
    vulnerableGroups,
    urgencyScore,
    priorityTier,
    recommendedDispatch,
    recommendedDispatches,
    agencyTag,
    reasoningSteps,
    reasoning: isSafe
      ? `[OFFLINE HEURISTIC FALLBACK] Safe-mark ping: Caller reports rescue completed or situation resolved at ${locationName}. No dispatch required.`
      : `[OFFLINE HEURISTIC FALLBACK] Automated rule extraction: ${peopleCount} person(s), ${waterLevelFeet}ft water at ${locationName}. ${vulnerableGroups.length > 0 ? "Vulnerable: " + vulnerableGroups.join(", ") + "." : ""} Score ${urgencyScore}.`,
    aiSource: "heuristic_fallback" as const,
  };
}

export async function evaluateTriage(
  message: string,
  hintCoords?: Coordinates | null,
  hintLocation?: string | null
): Promise<Omit<Incident, "id" | "rawText" | "status" | "timestamp" | "isDuplicateOf" | "caller" | "mergedReportsCount" | "operationalNotes" | "auditLog">> {
  const apiKey = process.env.FEATHERLESS_API_KEY || "";
  const baseURL = process.env.FEATHERLESS_BASE_URL || "https://api.featherless.ai/v1";

  if (!apiKey || apiKey === "your-featherless-api-key" || apiKey === "missing-key") {
    return heuristicFallback(message, hintCoords, hintLocation);
  }

  try {
    const client = new OpenAI({ baseURL, apiKey });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 1500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
    });

    const rawOutput = completion.choices?.[0]?.message?.content;
    if (!rawOutput) throw new Error("Empty LLM response");

    const parsed = extractJsonObject(rawOutput);

    let coords: Coordinates;
    if (hintCoords && typeof hintCoords.lat === "number" && typeof hintCoords.lng === "number" && !isNaN(hintCoords.lat) && !isNaN(hintCoords.lng)) {
      coords = { lat: hintCoords.lat, lng: hintCoords.lng };
    } else {
      let lat = Number(parsed.coordinates && typeof parsed.coordinates === "object" ? (parsed.coordinates as Record<string, unknown>).lat : 0);
      let lng = Number(parsed.coordinates && typeof parsed.coordinates === "object" ? (parsed.coordinates as Record<string, unknown>).lng : 0);
      if ((lat === 0 && lng === 0) || isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        const anchor = HYDERABAD_ANCHORS[Math.floor(Math.random() * HYDERABAD_ANCHORS.length)];
        lat = anchor.lat + (Math.random() - 0.5) * 0.02;
        lng = anchor.lng + (Math.random() - 0.5) * 0.02;
      }
      coords = { lat: parseFloat(lat.toFixed(4)), lng: parseFloat(lng.toFixed(4)) };
    }

    const urgencyScore = clamp(Math.round(Number(parsed.urgencyScore ?? 50)), 1, 100);
    const rawDispatch = String(parsed.recommendedDispatch ?? "");
    const recommendedDispatch: DispatchAsset = VALID_DISPATCH.includes(rawDispatch as DispatchAsset) ? (rawDispatch as DispatchAsset) : deriveDispatch(urgencyScore, message);

    const parsedPeopleCount = Math.max(1, Math.round(Number(parsed.peopleCount ?? 1)));
    let recommendedDispatches: RecommendedDispatchItem[] = [];
    if (Array.isArray(parsed.recommendedDispatches) && parsed.recommendedDispatches.length > 0) {
      recommendedDispatches = (parsed.recommendedDispatches as any[])
        .map((item) => ({
          resource: String(item.resource || item.asset || item.name || recommendedDispatch),
          quantity: Math.max(1, Number(item.quantity || 1)),
          reason: item.reason ? String(item.reason) : undefined,
        }))
        .filter((item) => item.resource.length > 0);
    }
    if (recommendedDispatches.length === 0) {
      recommendedDispatches = deriveMultiDispatches(urgencyScore, message, recommendedDispatch, parsedPeopleCount);
    }

    const rawAgency = String(parsed.agencyTag ?? "");
    const agencyTag: AgencyTag = VALID_AGENCY.includes(rawAgency as AgencyTag) ? (rawAgency as AgencyTag) : deriveAgency(recommendedDispatch);

    const rawVulnerable = parsed.vulnerableGroups;
    const vulnerableGroups: string[] = Array.isArray(rawVulnerable) ? rawVulnerable.filter((g: unknown) => typeof g === "string" && g.length > 0) : [];

    const rawSteps = parsed.reasoningSteps;
    const reasoningSteps: string[] = Array.isArray(rawSteps) && rawSteps.length > 0
      ? rawSteps.filter((s: unknown) => typeof s === "string").slice(0, 6)
      : [
          "Step 1: Entity parsing and dialect identification",
          `Step 2: Geospatial anchoring (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`,
          "Step 3: Threat vector and vulnerability analysis",
          `Step 4: Urgency score computation → ${urgencyScore}`,
          `Step 5: Tactical asset allocation → ${recommendedDispatch}`,
        ];

    const locationName = hintLocation || String(parsed.locationName ?? "Disaster Zone");

    return {
      locationName,
      coordinates: coords,
      waterLevelFeet: Math.max(0, Number(parsed.waterLevelFeet ?? 0)),
      peopleCount: parsedPeopleCount,
      vulnerableGroups,
      urgencyScore,
      priorityTier: deriveTier(urgencyScore),
      recommendedDispatch,
      recommendedDispatches,
      agencyTag,
      reasoningSteps,
      reasoning: String(parsed.reasoning ?? "AI analysis completed."),
      aiSource: "featherless",
    };
  } catch (apiError) {
    return heuristicFallback(message, hintCoords, hintLocation);
  }
}
