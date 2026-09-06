
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS engine_version VARCHAR(30);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS evidence_profile JSONB;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_pages JSONB;

CREATE TABLE IF NOT EXISTS indicator_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(80) NOT NULL,
  source_name VARCHAR(500) NOT NULL,
  source_date DATE,
  checksum CHAR(64),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evidence_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  indicator_id UUID REFERENCES indicators(id) ON DELETE CASCADE,
  missing_dimension VARCHAR(80) NOT NULL,
  recommendation TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
