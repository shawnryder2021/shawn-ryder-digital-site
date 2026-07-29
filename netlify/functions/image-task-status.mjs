// POST /api/image-task-status — admin-only. The browser polls this every few
// seconds after starting a task in generate-image.mjs, since a single Netlify
// function cannot sit and wait 30-90 seconds for Kie.ai to finish.

import { readJsonPost, ok, fail } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { str } from '../lib/validate.mjs';
import { checkImageTask } from '../lib/kie.mjs';

export default async (req) => {
  const { error, body } = await readJsonPost(req);
  if (error) return error;

  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const taskId = str(body.taskId, 200);
  if (!taskId) return fail(req, 422, 'Missing taskId.');

  if (!process.env.KIE_API_KEY) {
    return fail(req, 503, 'KIE_API_KEY is not set in Netlify environment variables.');
  }

  try {
    const result = await checkImageTask(taskId);
    return ok(req, result);
  } catch (err) {
    console.error('image-task-status: check failed', err);
    return fail(req, 502, 'Could not check on the image yet. Try again in a moment.');
  }
};

export const config = { path: '/api/image-task-status' };
