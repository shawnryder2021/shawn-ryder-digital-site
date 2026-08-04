// AI chat endpoint with streaming responses
// Handles visitor questions about services, suggests guides, captures emails

export const config = { path: '/api/chat' };

const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';
const apiKey = process.env.OPENROUTER_API_KEY;

// Rate limiting: per-IP and global
const rateLimits = new Map();
const LIMIT_PER_IP = 20;
const LIMIT_WINDOW_MS = 3600000; // 1 hour
let globalCount = 0;
let globalResetTime = Date.now() + LIMIT_WINDOW_MS;

const checkRateLimit = (ip) => {
  const now = Date.now();

  // Global limit
  if (now > globalResetTime) {
    globalCount = 0;
    globalResetTime = now + LIMIT_WINDOW_MS;
  }
  if (globalCount >= 500) return false; // 500 per hour global

  // Per-IP limit
  if (!rateLimits.has(ip)) {
    rateLimits.set(ip, { count: 0, resetAt: now + LIMIT_WINDOW_MS });
  }
  const limit = rateLimits.get(ip);
  if (now > limit.resetAt) {
    limit.count = 0;
    limit.resetAt = now + LIMIT_WINDOW_MS;
  }
  if (limit.count >= LIMIT_PER_IP) return false;

  limit.count++;
  globalCount++;
  return true;
};

const systemPrompt = `You are a helpful AI assistant for Shawn Ryder Digital, a digital marketing agency for car dealerships.

Your expertise covers:
- Search engine optimization (SEO) for dealerships
- Google Business Profile optimization
- Review management and response strategies
- Email marketing for automotive
- Lead follow-up processes
- Website conversion optimization
- AI search visibility (generative search, AI answer engines)
- Local marketing strategies

You speak directly to dealership owners, GSMs (General Sales Managers), and marketing managers.

Your tone is:
- Conversational and approachable (not corporate)
- Expert but never condescending
- Focused on ROI and what actually moves the needle
- Willing to give straight answers, not just sales talk

When appropriate:
- Suggest relevant guides from shawnryder.com/guides (mention title and topic)
- Point to specific tools: /review-calculator, /ai-visibility-check, /ai-crawler-check
- Ask clarifying questions to understand their specific situation
- Offer to connect them for a free audit

Never:
- Pretend to know about their specific business if you don't
- Make promises about traffic/leads without context
- Suggest tactics that won't work for their market
- Be overly formal or sales-y

If a visitor wants to discuss their specific situation in detail, suggest: "This would be worth a deeper conversation — request a free audit at shawnryder.com/contact and I can dig into your specific numbers."`;

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(ip)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Rate limited. Please try again later.',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { message, history = [] } = await req.json();
    if (!message || !message.trim()) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Message required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build message history (include last 10 messages for context)
    const messages = [
      ...history.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: message.trim() },
    ];

    // Call OpenRouter with streaming
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.7,
        max_tokens: 800,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenRouter error:', error);
      return new Response(
        JSON.stringify({ ok: false, error: 'AI service failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Stream the response back to the client
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    (async () => {
      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  await writer.write(
                    new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n`)
                  );
                }
              } catch {
                // Skip parse errors
              }
            }
          }
        }

        // Flush remaining buffer
        if (buffer.trim().startsWith('data: ')) {
          const data = buffer.slice(6).trim();
          if (data !== '[DONE]') {
            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                await writer.write(
                  new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n`)
                );
              }
            } catch {
              // Skip parse errors
            }
          }
        }

        await writer.write(new TextEncoder().encode('data: [DONE]\n'));
        await writer.close();
      } catch (err) {
        console.error('Stream error:', err);
        await writer.abort(err);
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
