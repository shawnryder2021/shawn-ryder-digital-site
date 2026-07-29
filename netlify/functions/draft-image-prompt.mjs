// POST /api/draft-image-prompt — admin-only. Turns a piece of content (a
// guide's title and excerpt, an image slot's label and the headline it sits
// beside) into an image prompt that already matches the site's art direction,
// so the admin edits a draft instead of starting from a blank textarea.
//
// This never touches Kie.ai — it only asks a text model to write a sentence.
// generate-image.mjs is the function that actually spends money making pixels.

import { readJsonPost, ok, fail } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { str } from '../lib/validate.mjs';

const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';

// Condensed from the site's own art-direction brief. The two failure modes
// this exists to prevent: a generic dealership-stock-photo look (the thing the
// site's own guides argue against), and images that visibly fight the page's
// one-accent-colour, no-warm-tones palette.
const SYSTEM_PROMPT = `You write prompts for an AI image generator, for a car-dealership marketing
consultant's website (shawnryder.com — Halifax, Nova Scotia; brands: Volkswagen,
Hyundai, Audi, Subaru, independent used).

House style, always:
- Documentary photograph. Never illustration, render, 3D, or diagram.
- Maritime overcast light — flat, cool, high cloud. Not golden hour.
- Mainstream cars (compact SUVs, sedans), never exotic or luxury flagship.
- Desaturated, cool-neutral colour grading. The page's only accent is an
  electric blue (#2c4bff) on a near-white ground — avoid strong orange, gold or
  teal casts that would fight it.
- No people in sharp focus, no readable text, signage, or badges anywhere in
  frame — those are the fastest tells of an AI generation and a trademark risk.

Always avoid: glass showrooms in golden-hour light, handshakes, oversized keys
or bows, exotic/luxury cars, glowing tech/circuit-board/robot imagery.

Given a short description of what the image is for, write ONE image-generation
prompt: 2-4 sentences, concrete and visual, no markdown, no quotation marks, no
preamble. Output only the prompt itself.`;

async function draftPrompt(subject, aspectRatio) {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'HTTP-Referer': 'https://shawnryder.com',
      'X-Title': 'Shawn Ryder Digital - image prompt drafting',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 220,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Image is for: ${subject}\nAspect ratio: ${aspectRatio || 'not specified'}` },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'OpenRouter returned an error.');
  return body.choices?.[0]?.message?.content?.trim() || '';
}

export default async (req) => {
  const { error, body } = await readJsonPost(req);
  if (error) return error;

  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const subject = str(body.subject, 2000);
  const aspectRatio = str(body.aspectRatio, 20);
  if (!subject) return fail(req, 422, 'No content to base a prompt on.');

  if (!process.env.OPENROUTER_API_KEY) {
    return fail(req, 503, 'OPENROUTER_API_KEY is not set — the same key the AI visibility checker uses.');
  }

  try {
    const prompt = await draftPrompt(subject, aspectRatio);
    if (!prompt) return fail(req, 502, 'The model returned an empty prompt. Try again.');
    return ok(req, { prompt });
  } catch (err) {
    console.error('draft-image-prompt: failed', err);
    return fail(req, 502, 'Could not draft a prompt right now. You can write one by hand below.');
  }
};

export const config = { path: '/api/draft-image-prompt' };
