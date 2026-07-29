// Generate email sequences for dealers using OpenRouter
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const rateLimits = new Map();
const LIMIT_PER_IP = 10;
const LIMIT_WINDOW_MS = 3600000;

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

    const { scenario } = await req.json();
    const validScenarios = ['post-sale', 'service', 'review-request'];
    if (!validScenarios.includes(scenario)) {
      return new Response(JSON.stringify({ ok: false, error: `Invalid scenario. Must be one of: ${validScenarios.join(', ')}` }), { status: 400 });
    }

    const scenarioPrompts = {
      'post-sale': {
        title: 'Post-Sale Follow-Up Sequence (5 days)',
        description: 'Emails to send after a customer buys a car',
        system: `You are writing email templates for car dealerships to send to customers who just purchased a vehicle. Your emails are:
- Friendly and professional, not salesy
- Short (2-3 short paragraphs max)
- Focused on customer success and satisfaction
- Designed to build a relationship, not push more sales
- Ready to copy-paste into email marketing platforms

Email tone: Warm, helpful, genuine.`,
        user: `Generate a 5-email sequence for post-purchase follow-up. Each email should span multiple days (Day 1, Day 3, Day 5, Day 10, Day 30).

For each email, provide:
- Day: when to send it
- Subject: compelling subject line
- Body: email body (2-3 paragraphs)

Format as JSON:
[
  { "day": 1, "subject": "...", "body": "..." },
  ...
]

Focus on: delivery day thank you, paperwork/registration help, maintenance reminders, review/referral ask.`,
      },
      'service': {
        title: 'Service Appointment Follow-Up Sequence (3 emails)',
        description: 'Emails to send after a service appointment',
        system: `You are writing email templates for car dealerships to send to customers after service. Your emails are:
- Warm and professional
- Short and scannable
- Focused on ensuring customer satisfaction
- Designed to encourage reviews and repeat service
- Ready to copy-paste into email platforms

Email tone: Friendly and helpful.`,
        user: `Generate a 3-email sequence for post-service follow-up.

For each email, provide:
- Timing: when to send it (e.g., "Day after service")
- Subject: compelling subject line
- Body: email body (2-3 short paragraphs)

Format as JSON:
[
  { "timing": "Day after service", "subject": "...", "body": "..." },
  ...
]

Focus on: satisfaction check, service tips, next appointment reminder, review request.`,
      },
      'review-request': {
        title: 'Review Request Sequence (2 emails)',
        description: 'Dedicated emails to ask for Google reviews',
        system: `You are writing email templates for car dealerships to ask for Google reviews. Your emails are:
- Clear and direct about the ask
- Grateful and humble
- Short and scannable
- Not pushy or manipulative
- Provide easy links/instructions
- Ready to copy-paste into email platforms

Email tone: Grateful and professional.`,
        user: `Generate a 2-email sequence specifically for asking customers to leave Google reviews.

For each email, provide:
- Timing: when to send it
- Subject: compelling subject line (make the ask clear)
- Body: email body with review link (use [GOOGLE_REVIEW_LINK] as placeholder)

Format as JSON:
[
  { "timing": "Day 3-5 after purchase/service", "subject": "...", "body": "..." },
  ...
]

Focus on: why reviews matter, how to leave one, a specific ask ("Takes 60 seconds"), gratitude.`,
      },
    };

    const prompt = scenarioPrompts[scenario];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5',
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenRouter error:', error);
      return new Response(JSON.stringify({ ok: false, error: 'AI service failed' }), { status: 500 });
    }

    const data = await response.json();
    const emailText = data.choices[0].message.content;

    let emails;
    try {
      emails = JSON.parse(emailText);
    } catch {
      emails = emailText;
    }

    return new Response(JSON.stringify({ ok: true, scenario, title: prompt.title, description: prompt.description, emails }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
};
