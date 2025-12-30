-- NSR Specialists Database Schema
-- This schema stores scraped specialist data from the Malaysian National Specialist Register

CREATE TABLE IF NOT EXISTS specialists (
    nsr_no VARCHAR(20) PRIMARY KEY,
    name TEXT,
    title TEXT,
    gender VARCHAR(10),
    specialty TEXT,
    state TEXT,
    state_id INTEGER,
    state_category TEXT,
    city TEXT,
    address TEXT,
    establishment TEXT,
    sector TEXT,
    last_renewal_date DATE,
    profile_url TEXT,
    qualifications JSONB,
    qualifications_structured JSONB,
    scraped_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_scraped TIMESTAMP DEFAULT NOW()  -- For future delta crawls
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_specialists_state ON specialists(state);
CREATE INDEX IF NOT EXISTS idx_specialists_specialty ON specialists(specialty);
CREATE INDEX IF NOT EXISTS idx_specialists_state_specialty ON specialists(state, specialty);
CREATE INDEX IF NOT EXISTS idx_specialists_last_scraped ON specialists(last_scraped);  -- For delta crawl queries
CREATE INDEX IF NOT EXISTS idx_specialists_name ON specialists USING gin(to_tsvector('english', name));  -- Full-text search on names

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to update updated_at on row updates
CREATE TRIGGER update_specialists_updated_at BEFORE UPDATE ON specialists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE specialists IS 'Stores specialist data scraped from NSR website';
COMMENT ON COLUMN specialists.nsr_no IS 'NSR registration number (primary key)';
COMMENT ON COLUMN specialists.qualifications IS 'JSON array of qualification strings';
COMMENT ON COLUMN specialists.qualifications_structured IS 'JSON array of structured qualification objects with degree, awardingBody, year';
COMMENT ON COLUMN specialists.last_scraped IS 'Timestamp of last successful scrape - used for delta crawls';

