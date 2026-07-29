// POST /api/generate-image — admin-only. Starts a Kie.ai generation task and
// returns immediately with a task id; it does not wait for the image.
//
// GPT Image 2 typically takes 30-90 seconds — far past Netlify's 10s
// synchronous limit — so waiting happens as the browser polling
// image-task-status.mjs every few seconds, not as this function blocking.

import { readJsonPost, ok, fail } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { str } from '../lib/validate.mjs';
import { startImageTask } from '../lib/kie.mjs';

const RATIOS = new Set(['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21']);

export default async (req) => {
  const { error, body } = await readJsonPost(req);
  if (error) return error;

  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const prompt = str(body.prompt, 4000);
  const aspectRatio = str(body.aspectRatio, 20) || 'auto';
  if (!prompt) return fail(req, 422, 'Write or generate a prompt first.');
  if (!RATIOS.has(aspectRatio)) return fail(req, 422, `Unsupported aspect ratio: ${aspectRatio}`);

  if (!process.env.KIE_API_KEY) {
    return fail(req, 503, 'KIE_API_KEY is not set in Netlify environment variables.');
  }

  try {
    const taskId = await startImageTask(prompt, aspectRatio);
    return ok(req, { taskId });
  } catch (err) {
    console.error('generate-image: could not start task', err);
    const reason = {
      401: 'Kie.ai rejected the API key. Check KIE_API_KEY in Netlify.',
      402: 'The Kie.ai account is out of credit.',
      429: 'Kie.ai rate-limited the request. Try again shortly.',
    }[err.status] || err.message || 'Could not start image generation.';
    return fail(req, 502, reason);
  }
};

export const config = { path: '/api/generate-image' };
