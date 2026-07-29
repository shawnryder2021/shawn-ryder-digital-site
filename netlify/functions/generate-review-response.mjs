// Generate professional review responses using OpenRouter
// Rate limiting via in-memory store (reset on function restart)

// In-memory rate limits
const rateLimits = new Map();
const GLOBAL_LIMIT = 50; // per 5 minutes
const IP_LIMIT = 5; // per hour
const FIVE_MIN_MS = 5 * 60000;
const ONE_HOUR_MS = 3600000;

let globalRequests = [];
let globalResetTime = Date.now() + FIVE_MIN_MS;

const checkGlobalLimit = () => {
  const now = Date.now();
  if (now > globalResetTime) {
    globalRequests = [];
    globalResetTime = now + FIVE_MIN_MS;
  }
  globalRequests.push(now);
  return globalRequests.length <= GLOBAL_LIMIT;
};

const checkIPLimit = (ip) => {
  const now = Date.now();
  if (!rateLimits.has(ip)) {
    rateLimits.set(ip, { requests: [], resetAt: now + ONE_HOUR_MS });
  }
  const limit = rateLimits.get(ip);
  if (now > limit.resetAt) {
    limit.requests = [];
    limit.resetAt = now + ONE_HOUR_MS;
  }
  limit.requests.push(now);
  return limit.requests.length <= IP_LIMIT;
};

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown';

    const globalOk = checkGlobalLimit();
    if (!globalOk) {
      return new Response(JSON.stringify({ ok: false, error: 'Service temporarily busy. Try again in a few minutes.' }), { status: 429 });
    }

    const ipOk = checkIPLimit(ip);
    if (!ipOk) {
      return new Response(JSON.stringify({ ok: false, error: 'You\'ve used your quota. 5 responses per hour.' }), { status: 429 });
    }

    const { review_text, dealership_name } = await req.json();
    if (!review_text) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing review text' }), { status: 400 });
    }

    const systemPrompt = `You are helping a professional car dealership respond to a negative review on Google. Your responses are:
- Professional and courteous, never defensive
- Specific — they address the actual complaint, not generic platitudes
- Brief (2-3 sentences max)
- Solution-focused or empathetic
- Written to influence other potential customers reading the review

You never:
- Argue with the reviewer
- Make excuses
- Offer generic apologies
- Promise things you can't deliver
- Get emotional or sarcastic

Your goal: show other shoppers that the dealership takes feedback seriously and handles problems professionally.`;

    const dealershipContext = dealership_name ? ` for ${dealership_name}` : '';
    const userPrompt = `Generate 3 different professional responses${dealershipContext} to this negative review:

"${review_text}"

Provide exactly 3 JSON responses in this format:
[
  { "approach": "empathetic", "response": "The actual response text here" },
  { "approach": "solution-focused", "response": "The actual response text here" },
  { "approach": "specific-acknowledgment", "response": "The actual response text here" }
]`;

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
        temperature: 0.8,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenRouter error:', error);
      return new Response(JSON.stringify({ ok: false, error: 'AI service failed' }), { status: 500 });
    }

    const data = await response.json();
    const responseText = data.choices[0].message.content;

    let responses;
    try {
      responses = JSON.parse(responseText);
    } catch {
      responses = responseText;
    }

    return new Response(JSON.stringify({ ok: true, responses }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
};
