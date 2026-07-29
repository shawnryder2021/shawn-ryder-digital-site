// Generate professional review responses using OpenRouter
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Global rate limit check via Supabase
const checkGlobalLimit = async () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
  const { count } = await supabase
    .from('ai_api_calls')
    .select('*', { count: 'exact', head: true })
    .eq('endpoint', 'generate-review-response')
    .gte('created_at', fiveMinutesAgo);
  return (count || 0) < 50; // 50 per 5 minutes
};

const checkIPLimit = async (ip) => {
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count } = await supabase
    .from('ai_api_calls')
    .select('*', { count: 'exact', head: true })
    .eq('endpoint', 'generate-review-response')
    .eq('ip_hash', hashIP(ip))
    .gte('created_at', oneHourAgo);
  return (count || 0) < 5; // 5 per hour
};

const hashIP = (ip) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  return Array.from(new Uint8Array(data)).map(x => x.toString(16).padStart(2, '0')).join('');
};

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown';

    const globalOk = await checkGlobalLimit();
    if (!globalOk) {
      return new Response(JSON.stringify({ ok: false, error: 'Service temporarily busy. Try again in a few minutes.' }), { status: 429 });
    }

    const ipOk = await checkIPLimit(ip);
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

    // Log the API call
    await supabase.from('ai_api_calls').insert({
      endpoint: 'generate-review-response',
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5',
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
      cost: ((data.usage?.prompt_tokens || 0) * 0.00005 + (data.usage?.completion_tokens || 0) * 0.00015) / 1000,
      ip_hash: hashIP(ip),
    });

    return new Response(JSON.stringify({ ok: true, responses }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
};
