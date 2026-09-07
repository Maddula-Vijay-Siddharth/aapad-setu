# Aapad Setu: Autonomous Multilingual Disaster Triage & Emergency Response System

An end-to-end emergency response architecture designed for mass-casualty disaster events (floods, cyclones, earthquakes). The system bridges disconnected victims in disaster zones to emergency dispatchers via telephony gateways and autonomous AI triage.

---

## 🏗️ End-to-End Architecture

```text
[Victim App] (Offline Android)
      │
      │ SMS / MMS (Cellular network)
      ▼
[Receiver App] (Android Telephony Bridge)
      │
      │ Direct PostgREST (Publishable Anon Key over Internet/Mobile Data)
      ▼
[Supabase Cloud] (PostgreSQL Database & Realtime Engine)
      │
      │ Server-Side API (Secret Key)
      ▼
[Aapad Setu Web Dashboard] (Next.js 16 Command Center)
      │
      │      Server-Side AI Prompting (DeepSeek-V3)
      ▼
[Featherless AI] (Autonomous Triage & Resource Recommendation)
```

---

## 📱 Subsystems Overview

### 1. Victim App (`C:\Siddu\Diaster management`)
- **Type**: Native Android Application (Kotlin, Jetpack Compose).
- **Functionality**:
  - Allows citizens to enter: **Name**, **People Affected**, **Emergency Type**, **Description**, **GPS Coordinates**, and **Landmark**.
  - No phone input required; reports are dispatched directly via the device's SIM card.
  - Audio recording disabled for streamlined text transmission during bandwidth-constrained emergencies.
  - Generates standardized cellular emergency text messages starting strictly with `EMERGENCY REPORT`.
  - Operates 100% offline without requiring internet access or API secrets.

### 2. Receiver App (`C:\Siddu\DisasterReciver`)
- **Type**: Native Android Telephony Gateway (Kotlin, Background Services).
- **Functionality**:
  - Monitors incoming SMS/MMS messages.
  - Strictly filters for messages beginning with `EMERGENCY REPORT`.
  - Automatically captures the sender's phone number directly from telephony metadata.
  - Preserves victim Name and exact `people_count` as reported by the victim.
  - Synchronizes directly with Supabase cloud using the project publishable key.
  - Employs deterministic UUIDs (`UUID.nameUUIDFromBytes`) for idempotency, ensuring repeated message arrivals do not duplicate records.
  - Zero server secrets or AI keys stored in the APK.

### 3. Dispatcher Web Dashboard & Backend (`C:\Siddu\Res-Q-main`)
- **Type**: Next.js 16 Web Platform (React, TypeScript, Tailwind CSS, Leaflet GIS).
- **Functionality**:
  - Real-time command grid displaying active disaster incidents, live GIS map, and fleet status.
  - Displays database `people_count`, caller name, and automatically received phone number.
  - Executes autonomous server-side triage powered by Featherless AI (`deepseek-ai/DeepSeek-V3`).
  - Evaluates distress reports for Urgency Score (1-100), Priority Tier (Critical, High, Moderate, Low), Tactical Asset Allocation (e.g., NDRF Rescue Boat, ALS Ambulance), and Agency Tag (NDRF, SDRF, FIRE, MEDICAL).
  - Maintains a persistent audit trail for dispatch actions.

---

## 🚀 Getting Started

### Project 1: Victim App
```powershell
cd "C:\Siddu\Diaster management"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat test
.\gradlew.bat assembleDebug
```
*The compiled APK will be located at:* `app\build\outputs\apk\debug\app-debug.apk`

### Project 2: Receiver App
```powershell
cd "C:\Siddu\DisasterReciver"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat test
.\gradlew.bat assembleDebug
```
*The compiled APK will be located at:* `app\build\outputs\apk\debug\app-debug.apk`

### Project 3: Dispatcher Website
```powershell
cd "C:\Siddu\Res-Q-main"
npm install
npm run build
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to access the incident command grid.

---

## ⚙️ Environment Configuration (`.env.local`)

In `C:\Siddu\Res-Q-main\.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-supabase-project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-publishable-anon-key>
SUPABASE_SECRET_KEY=<your-secret-key>
FEATHERLESS_API_KEY=<your-featherless-api-key>
```

---

## 🧪 End-to-End Verification

To verify the complete pipeline end-to-end:
```powershell
cd "C:\Siddu\Res-Q-main"
node "C:\Users\Santosh Siddharth\.gemini\antigravity\brain\10ca5d6a-2c84-4617-990c-6222defdb157\scratch\verify_critical_test.js"
```

The test validates:
1. Victim App format generation (`Name: Test Person`, `People affected: 5`, GPS coordinates).
2. Receiver App telephony number extraction and entity parsing.
3. Supabase PostgREST ingest via publishable key with idempotency.
4. Server-side Featherless DeepSeek-V3 AI triage execution.
5. Exact preservation and dashboard display of Name, People count (= 5), Phone, and GPS coordinates without audio.

---

## 🔒 Copyright & Intellectual Property

Copyright © 2026 Aapad Setu. All rights reserved.

All source code, schemas, documentation, and assets within this repository are proprietary. No part of this codebase may be reproduced, distributed, or transmitted in any form or by any means, including photocopying, recording, or other electronic or mechanical methods, without prior written permission from the copyright holder, except for evaluation and judging purposes.
