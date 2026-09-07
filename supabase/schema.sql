CREATE TABLE IF NOT EXISTS fleet_inventory (
    asset_name TEXT PRIMARY KEY,
    total INTEGER NOT NULL DEFAULT 0,
    available INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO fleet_inventory (asset_name, total, available)
VALUES
    ('NDRF Rescue Boat', 4, 4),
    ('ALS Ambulance', 3, 3),
    ('Drone Ration Drop', 5, 5),
    ('SDRF Rescue Truck', 2, 2),
    ('Standby / Monitor', 999, 999)
ON CONFLICT (asset_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emergency_type TEXT,
    description TEXT,
    location_name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    location_accuracy DOUBLE PRECISION,
    landmark TEXT,
    water_level_feet NUMERIC DEFAULT 0,
    people_count INTEGER NOT NULL DEFAULT 1,
    vulnerable_groups TEXT[] DEFAULT '{}',
    urgency_score INTEGER NOT NULL DEFAULT 50,
    priority_tier TEXT NOT NULL CHECK (priority_tier IN ('Critical', 'High', 'Moderate', 'Low')),
    recommended_dispatch TEXT NOT NULL,
    assigned_agency TEXT NOT NULL,
    incident_status TEXT NOT NULL DEFAULT 'Pending' CHECK (incident_status IN ('Pending', 'Dispatched', 'Resolved')),
    caller_name TEXT,
    caller_phone TEXT,
    verification_code TEXT,
    is_duplicate_of UUID REFERENCES incidents(id) ON DELETE SET NULL,
    merged_reports_count INTEGER NOT NULL DEFAULT 1,
    reasoning TEXT,
    reasoning_steps TEXT[] DEFAULT '{}',
    ai_source TEXT NOT NULL DEFAULT 'featherless',
    operational_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    caller_name TEXT,
    caller_phone TEXT,
    channel TEXT DEFAULT 'web',
    people_count INTEGER DEFAULT 1,
    water_level_feet NUMERIC DEFAULT 0,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispatch_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    asset_name TEXT NOT NULL REFERENCES fleet_inventory(asset_name) ON UPDATE CASCADE,
    status TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched', 'en_route', 'on_scene', 'resolved', 'cancelled')),
    actor TEXT NOT NULL DEFAULT 'ADMIN-01',
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS operational_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    actor TEXT NOT NULL DEFAULT 'ADMIN-01',
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'ADMIN-01',
    metadata JSONB DEFAULT '{}'::jsonb,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_priority ON incidents(priority_tier);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(incident_status);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_reports_incident_id ON incident_reports(incident_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_actions_incident_id ON dispatch_actions(incident_id);
CREATE INDEX IF NOT EXISTS idx_operational_notes_incident_id ON operational_notes(incident_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_incident_id ON audit_logs(incident_id);

ALTER TABLE fleet_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fleet_inventory' AND policyname = 'Allow public read fleet_inventory') THEN
        CREATE POLICY "Allow public read fleet_inventory" ON fleet_inventory FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fleet_inventory' AND policyname = 'Allow public write fleet_inventory') THEN
        CREATE POLICY "Allow public write fleet_inventory" ON fleet_inventory FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'incidents' AND policyname = 'Allow public read incidents') THEN
        CREATE POLICY "Allow public read incidents" ON incidents FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'incidents' AND policyname = 'Allow public write incidents') THEN
        CREATE POLICY "Allow public write incidents" ON incidents FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'incident_reports' AND policyname = 'Allow public read incident_reports') THEN
        CREATE POLICY "Allow public read incident_reports" ON incident_reports FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'incident_reports' AND policyname = 'Allow public write incident_reports') THEN
        CREATE POLICY "Allow public write incident_reports" ON incident_reports FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dispatch_actions' AND policyname = 'Allow public read dispatch_actions') THEN
        CREATE POLICY "Allow public read dispatch_actions" ON dispatch_actions FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dispatch_actions' AND policyname = 'Allow public write dispatch_actions') THEN
        CREATE POLICY "Allow public write dispatch_actions" ON dispatch_actions FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'operational_notes' AND policyname = 'Allow public read operational_notes') THEN
        CREATE POLICY "Allow public read operational_notes" ON operational_notes FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'operational_notes' AND policyname = 'Allow public write operational_notes') THEN
        CREATE POLICY "Allow public write operational_notes" ON operational_notes FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'Allow public read audit_logs') THEN
        CREATE POLICY "Allow public read audit_logs" ON audit_logs FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'Allow public write audit_logs') THEN
        CREATE POLICY "Allow public write audit_logs" ON audit_logs FOR ALL USING (true);
    END IF;
END $$;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE incidents;
    EXCEPTION WHEN duplicate_object THEN
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE fleet_inventory;
    EXCEPTION WHEN duplicate_object THEN
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE dispatch_actions;
    EXCEPTION WHEN duplicate_object THEN
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE operational_notes;
    EXCEPTION WHEN duplicate_object THEN
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE audit_logs;
    EXCEPTION WHEN duplicate_object THEN
    END;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('emergency-audio', 'emergency-audio', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow anon upload to emergency-audio'
    ) THEN
        CREATE POLICY "Allow anon upload to emergency-audio"
        ON storage.objects FOR INSERT TO anon
        WITH CHECK (bucket_id = 'emergency-audio');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow public read from emergency-audio'
    ) THEN
        CREATE POLICY "Allow public read from emergency-audio"
        ON storage.objects FOR SELECT TO public
        USING (bucket_id = 'emergency-audio');
    END IF;
END $$;
