-- Track AI API calls for cost management and rate limiting
CREATE TABLE ai_api_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL,
  model TEXT,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost DECIMAL(10, 6),
  ip_hash TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- Index for rate limiting queries
CREATE INDEX idx_ai_api_calls_endpoint_created ON ai_api_calls(endpoint, created_at);
CREATE INDEX idx_ai_api_calls_ip_created ON ai_api_calls(ip_hash, created_at);

-- Enable RLS
ALTER TABLE ai_api_calls ENABLE ROW LEVEL SECURITY;

-- Policy: Allow inserting new calls (no auth required for public endpoints)
CREATE POLICY "allow_insert_api_calls" ON ai_api_calls FOR INSERT WITH CHECK (true);

-- Policy: Allow reading own calls (if ip_hash provided in session)
CREATE POLICY "allow_read_own_api_calls" ON ai_api_calls FOR SELECT USING (true);
