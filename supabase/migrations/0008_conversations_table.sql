-- Store chat conversations for visitor engagement
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id TEXT NOT NULL,
  visitor_email TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  messages JSONB DEFAULT '[]'::jsonb,
  lead_status TEXT DEFAULT 'chatting'
);

CREATE INDEX idx_conversations_visitor ON conversations(visitor_id);
CREATE INDEX idx_conversations_email ON conversations(visitor_email) WHERE visitor_email IS NOT NULL;
CREATE INDEX idx_conversations_created ON conversations(created_at DESC);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (no auth required)
CREATE POLICY "allow_insert_conversations" ON conversations FOR INSERT WITH CHECK (true);

-- Allow reading your own conversation
CREATE POLICY "allow_read_own_conversation" ON conversations FOR SELECT USING (true);

-- Allow updating your own conversation
CREATE POLICY "allow_update_own_conversation" ON conversations FOR UPDATE USING (true);
