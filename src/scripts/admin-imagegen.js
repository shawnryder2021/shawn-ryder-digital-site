// "Generate with AI" — turns a slot's or guide's own content into a drafted
// image prompt, lets the admin edit and confirm it, generates through Kie.ai,
// and hands back a normal media row through the exact same upload pipeline a
// manual file picks would use (admin-media.js's uploadImage), so a generated
// image gets identical downscaling/storage/row-shape treatment rather than a
// second, divergent path.
//
// Three server calls, in order: draft-image-prompt (fast, a text model),
// generate-image (fast — starts a Kie.ai task and returns immediately),
// image-task-status (polled every few seconds — GPT Image 2 usually takes
// 30-90s, far past what a Netlify function may block for), then
// fetch-generated-image (proxies the finished picture back through our own
// domain so the browser can turn it into a Blob without depending on Kie.ai's
// CORS headers being permissive).

import { supabase } from '../lib/supabase-client.js';
import { el } from './dom.js';
import { uploadImage } from './admin-media.js';

const POLL_MS = 4000;
const MAX_POLLS = 45; // ~3 minutes — generous; GPT Image 2 is usually under 90s

async function authedPost(path, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired — sign in again.');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.error || `${path} failed (HTTP ${res.status})`);
  return body;
}

async function fetchGeneratedImage(url) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/fetch-generated-image', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not download the image (HTTP ${res.status})`);
  }
  return res.blob();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {object} opts
 * @param {() => string} opts.subject - built lazily, so it reflects whatever
 *   the admin has typed into the form so far, not just the record it opened with.
 * @param {string} opts.aspectRatio - one of Kie.ai's accepted ratios, e.g. '4:5'.
 * @param {(media: object) => void} opts.onUse - called with the new media row
 *   once the admin accepts the result.
 * @param {() => boolean} opts.guard - the app's admin-only gate.
 */
export function renderImageGenerator({ subject, aspectRatio, onUse, guard }) {
  const trigger = el('button', { class: 'btn btn-ghost sm', type: 'button' }, '✦ Generate with AI');
  const panel = el('div', { class: 'imagegen', hidden: true });
  const wrap = el('div', { class: 'imagegen-wrap' }, trigger, panel);

  let state = 'idle'; // idle | drafting | editing | generating | done | error
  let pollTimer = null;

  const stopPolling = () => { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; };

  const draw = () => {
    panel.hidden = state === 'idle';
    trigger.hidden = state !== 'idle';

    if (state === 'drafting') {
      panel.replaceChildren(el('p', { class: 'muted' }, 'Drafting a prompt from this content…'));
    }
  };

  trigger.addEventListener('click', async () => {
    if (!guard()) return;
    state = 'drafting';
    draw();
    try {
      const { prompt } = await authedPost('/api/draft-image-prompt', { subject: subject(), aspectRatio });
      showEditor(prompt);
    } catch (err) {
      showEditor('', err.message);
    }
  });

  function showEditor(promptText, draftError) {
    state = 'editing';
    const ta = el('textarea', { rows: 5, class: 'code' });
    ta.value = promptText;

    const status = el('div', { class: 'muted small' });
    if (draftError) {
      status.textContent = `Could not draft one automatically (${draftError}). Write your own below.`;
    }

    const generateBtn = el('button', { class: 'btn btn-primary sm', type: 'button' }, 'Generate image');
    const cancelBtn = el('button', { class: 'btn btn-ghost sm', type: 'button', onClick: () => {
      stopPolling();
      state = 'idle';
      draw();
    } }, 'Cancel');

    generateBtn.addEventListener('click', () => runGeneration(ta.value.trim()));

    panel.replaceChildren(
      el('label', { class: 'imagegen-label' }, `Prompt (${aspectRatio})`, ta),
      status,
      el('div', { class: 'imagegen-actions' }, generateBtn, cancelBtn));
    draw();
  }

  async function runGeneration(prompt) {
    if (!prompt) return;
    state = 'generating';
    panel.replaceChildren(el('p', { class: 'muted' }, 'Starting generation…'));
    draw();

    try {
      const { taskId } = await authedPost('/api/generate-image', { prompt, aspectRatio });
      panel.replaceChildren(el('p', { class: 'muted' }, 'Generating — this usually takes 30–90 seconds…'));
      await poll(taskId, prompt);
    } catch (err) {
      showFailure(err.message, prompt);
    }
  }

  async function poll(taskId, prompt) {
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      let result;
      try {
        result = await authedPost('/api/image-task-status', { taskId });
      } catch (err) {
        return showFailure(err.message, prompt);
      }
      if (result.state === 'done') return showResult(result.resultUrls[0], prompt);
      if (result.state === 'failed') return showFailure(result.message, prompt);
      // still pending — loop again
    }
    showFailure('Generation is taking longer than expected. It may still finish — try again shortly.', prompt);
  }

  async function showResult(resultUrl, prompt) {
    let blob;
    try {
      blob = await fetchGeneratedImage(resultUrl);
    } catch (err) {
      return showFailure(err.message, prompt);
    }

    const objectUrl = URL.createObjectURL(blob);
    const useBtn = el('button', { class: 'btn btn-primary sm', type: 'button' }, 'Use this image');
    const retryBtn = el('button', { class: 'btn btn-ghost sm', type: 'button', onClick: () => showEditor(prompt) }, 'Try a different prompt');

    useBtn.addEventListener('click', async () => {
      useBtn.disabled = true;
      useBtn.textContent = 'Saving…';
      try {
        const file = new File([blob], 'ai-generated.png', { type: blob.type || 'image/png' });
        const media = await uploadImage(file, { prompt, source: 'kie-ai', model: 'gpt-image-2-text-to-image' });
        URL.revokeObjectURL(objectUrl);
        state = 'idle';
        draw();
        onUse(media);
      } catch (err) {
        useBtn.disabled = false;
        useBtn.textContent = 'Use this image';
        panel.append(el('p', { class: 'cerr' }, err.message));
      }
    });

    panel.replaceChildren(
      el('img', { src: objectUrl, class: 'imagegen-preview', alt: '' }),
      el('div', { class: 'imagegen-actions' }, useBtn, retryBtn));
    draw();
  }

  function showFailure(message, prompt) {
    state = 'error';
    panel.replaceChildren(
      el('p', { class: 'cerr' }, message),
      el('div', { class: 'imagegen-actions' },
        el('button', { class: 'btn btn-ghost sm', type: 'button', onClick: () => showEditor(prompt) }, 'Back to prompt')));
    draw();
  }

  draw();
  return wrap;
}
