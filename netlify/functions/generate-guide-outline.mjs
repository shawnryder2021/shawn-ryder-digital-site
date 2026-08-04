// Generate a guide outline using OpenRouter
import { createClient } from '@supabase/supabase-js';

export const config = { path: '/api/generate-guide-outline' };

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Rate limiting: track per IP
const rateLimits = new Map();
const LIMIT_PER_IP = 10;
const LIMIT_WINDOW_MS = 3600000; // 1 hour

const checkRateLimit = (ip) => {
  const now = Date.now();
  if (!rateLimits.has(ip)) {
    rateLimits.set(ip, { count: 0, resetAt: now + LIMIT_WINDOW_MS });
  }
  const limit = rateLimits.get(ip);
  if (now > limit.resetAt) {
    limit.count = 0;
    limit.resetAt = now + LIMIT_WINDOW_MS;
  }
  limit.count++;
  return limit.count <= LIMIT_PER_IP;
};

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    // Auth check (admin only)
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    const { data: user } = await supabase.auth.admin.getUserById(token.split('.')[1]?.slice(0, 36) || '');
    if (!user) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    // Rate limit
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({ ok: false, error: 'Rate limited' }), { status: 429 });
    }

    const { title, category, excerpt } = await req.json();
    if (!title || !category) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing title or category' }), { status: 400 });
    }

    const systemPrompt = `You are writing guides for car dealership marketing professionals. These are educational articles about dealer reputation, SEO, email marketing, review management, and lead follow-up.

Your guides are:
- Practical and tactical, not theoretical
- Based on 15+ years of dealership marketing experience
- Written for busy dealer principals and GSMs
- Focused on what actually moves the needle

You write in a conversational but authoritative tone. You avoid jargon unless unavoidable.`;

    const userPrompt = `Generate a detailed outline for a guide titled: "${title}"

Category: ${category}
${excerpt ? `Excerpt/Summary: ${excerpt}` : ''}

Respond with a JSON array of section objects with this structure:
[
  { "heading": "H2 heading text", "bullets": ["Point 1", "Point 2", "Point 3"] },
  ...
]

Generate 4-6 sections. Each section should have 2-4 bullet points. Make the outline specific and actionable, not generic.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenRouter error:', error);
      return new Response(JSON.stringify({ ok: false, error: 'AI service failed' }), { status: 500 });
    }

    const data = await response.json();
    const outline = data.choices[0].message.content;

    // Try to parse as JSON, fallback to text
    let sections;
    try {
      sections = JSON.parse(outline);
    } catch {
      // Return raw text if not valid JSON
      sections = outline;
    }

    return new Response(JSON.stringify({ ok: true, outline: sections }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
};
