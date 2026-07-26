// Image upload, downscaling and the media library.
//
// Photos come off phones at 4000px and 6MB. Uploading those raw would make a
// site sold on search performance load like treacle, and Supabase's free tier
// has no server-side image transforms — so the resize happens here, in the
// browser, before a single byte is sent.

import { supabase } from '../lib/supabase-client.js';

const MAX_EDGE = 2000;      // px on the longest side
const QUALITY = 0.82;       // JPEG/WebP quality
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export const formatBytes = (n) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

/** Reads intrinsic dimensions without adding the image to the page. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')); };
    img.src = url;
  });
}

/**
 * Downscales to MAX_EDGE and re-encodes. WebP when the browser can, else JPEG.
 * Transparent PNGs stay PNG so they do not gain a black background.
 * @returns {Promise<{blob: Blob, width: number, height: number, ext: string}>}
 */
export async function prepareImage(file) {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`That file is ${formatBytes(file.size)}. Please use one under 25 MB.`);
  }

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  // GIFs may be animated; re-encoding would flatten them to one frame.
  if (file.type === 'image/gif') {
    return { blob: file, width: img.naturalWidth, height: img.naturalHeight, ext: 'gif' };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const keepAlpha = file.type === 'image/png';
  const type = keepAlpha ? 'image/png'
    : canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp'
    : 'image/jpeg';

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
  if (!blob) throw new Error('Could not process that image.');

  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return { blob, width, height, ext };
}

const slugify = (name) =>
  name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 60) || 'image';

/**
 * Uploads one file and records it in the media table.
 * @returns {Promise<object>} the created media row
 */
export async function uploadImage(file, { alt = '' } = {}) {
  const { blob, width, height, ext } = await prepareImage(file);

  // Content-addressed enough to avoid collisions without needing a lookup.
  const stamp = Date.now().toString(36);
  const path = `${slugify(file.name)}-${stamp}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('media')
    .upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { data: pub } = supabase.storage.from('media').getPublicUrl(path);

  const { data, error } = await supabase
    .from('media')
    .insert({
      path, url: pub.publicUrl, alt,
      width, height, bytes: blob.size, mime: blob.type,
    })
    .select()
    .single();

  if (error) {
    // Do not leave an orphaned object behind if the row insert fails.
    await supabase.storage.from('media').remove([path]).catch(() => {});
    throw new Error(error.message);
  }
  return data;
}

/** Removes the row and the underlying object. */
export async function deleteImage(row) {
  const { error } = await supabase.from('media').delete().eq('id', row.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from('media').remove([row.path]).catch(() => {});
}

export async function listMedia() {
  const { data, error } = await supabase
    .from('media').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function listSlots() {
  const { data, error } = await supabase
    .from('image_slots').select('*, media:media_id(*)').order('key');
  if (error) throw new Error(error.message);
  return data;
}
