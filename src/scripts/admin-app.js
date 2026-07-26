// The admin application: sections, CRUD against Supabase, and Publish.
//
// Every read and write goes through the signed-in user's RLS context, so the
// server decides what they can do. The UI hides admin-only controls from a
// `user` account as a courtesy, not as the security boundary.

import { supabase, configured, currentProfile } from '../lib/supabase-client.js';
import {
  BLOCK_SCHEMAS, GUIDE_FIELDS, MARKET_FIELDS, REVIEW_FIELDS, NAV_FIELDS, CONTENT_TABLES,
} from '../lib/admin-schema.js';
import { el, renderForm, renderSimpleList, toStrings } from './admin-forms.js';
import {
  uploadImage, deleteImage, listMedia, listSlots, formatBytes,
} from './admin-media.js';

let profile = null;
let isAdmin = false;
const $ = (id) => document.getElementById(id);
const main = () => $('section-body');

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';

function toast(message, kind = 'good') {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast ${kind} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

/** Wraps a save so every editor reports failures the same way. */
async function save(fn, okMessage = 'Saved') {
  try {
    const { error } = (await fn()) ?? {};
    if (error) throw error;
    toast(okMessage);
    refreshPublishState();
    return true;
  } catch (err) {
    toast(err.message || 'Could not save', 'bad');
    return false;
  }
}

const guard = () => {
  if (!isAdmin) {
    toast('Read-only access — ask an admin to make this change.', 'bad');
    return false;
  }
  return true;
};

/* ------------------------------------------------------------- sections --- */

const SECTIONS = [
  { id: 'leads', label: 'Leads', render: renderLeads },
  { id: 'subscribers', label: 'Subscribers', render: renderSubscribers },
  { id: 'guides', label: 'Guides', render: renderGuides },
  { id: 'markets', label: 'Markets', render: renderMarkets },
  { id: 'pages', label: 'Page copy', render: renderPages },
  { id: 'images', label: 'Images', render: renderImages },
  { id: 'faq', label: 'FAQ', render: renderFaq },
  { id: 'reviews', label: 'Reviews', render: renderReviews },
  { id: 'menus', label: 'Menus', render: renderMenus },
  { id: 'settings', label: 'Settings', render: renderSettings },
];

function showSection(id) {
  document.querySelectorAll('.snav button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  main().replaceChildren(el('div', { class: 'loading' }, 'Loading…'));
  location.hash = id;
  SECTIONS.find((s) => s.id === id).render();
}

/* ---------------------------------------------------------------- leads --- */

const STATUSES = ['new', 'contacted', 'qualified', 'closed', 'spam'];

async function renderLeads() {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return main().replaceChildren(el('div', { class: 'empty' }, error.message));
  if (!data.length) {
    return main().replaceChildren(
      el('div', { class: 'empty' }, "No leads yet. They'll appear the moment someone submits the audit form.")
    );
  }

  const rows = data.map((lead) => {
    const status = isAdmin
      ? el('select', { class: 'pill-select',
          onChange: async (e) => {
            const value = e.target.value;
            await save(() => supabase.from('leads').update({ status: value }).eq('id', lead.id), 'Status updated');
          } },
          ...STATUSES.map((s) => el('option', { value: s, ...(s === lead.status ? { selected: true } : {}) }, s)))
      : el('span', { class: 'pill' }, lead.status);

    return el('tr', {},
      el('td', { class: 'nowrap' }, fmtDate(lead.created_at),
        el('small', {}, [lead.source_page, lead.market_slug].filter(Boolean).join(' · '))),
      el('td', {}, lead.name),
      el('td', {}, lead.dealership || '—'),
      el('td', {},
        el('a', { href: `mailto:${lead.email}` }, lead.email),
        lead.phone ? el('small', {}, el('a', { href: `tel:${lead.phone}` }, lead.phone)) : null),
      el('td', { class: 'notes' }, lead.message || '—',
        (lead.checklist || []).length
          ? el('ul', { class: 'ticks' }, ...lead.checklist.map((c) => el('li', {}, c)))
          : null),
      el('td', {}, status),
      el('td', {}, el('span', {
        class: `pill ${lead.webhook_status === 'delivered' ? 'ok' : 'warn'}`,
      }, lead.webhook_status || 'n/a')));
  });

  // A failing webhook is invisible otherwise — the lead still saves, so nothing
  // looks broken until you notice notifications stopped arriving.
  const failed = data.filter((l) => l.webhook_status === 'failed');
  const banner = failed.length
    ? el('div', { class: 'warnbar' },
        el('strong', {}, `${failed.length} lead${failed.length === 1 ? '' : 's'} did not reach your notification webhook.`),
        el('span', {}, ' The leads themselves are safe and listed below — only the notification failed. '),
        el('code', {}, failed[0].webhook_error || 'unknown error'))
    : null;

  main().replaceChildren(
    banner,
    table(['Received', 'Name', 'Dealership', 'Contact', 'Notes', 'Status', 'Webhook'], rows));
}

async function renderSubscribers() {
  const { data, error } = await supabase
    .from('newsletter_subscribers').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return main().replaceChildren(el('div', { class: 'empty' }, error.message));
  if (!data.length) return main().replaceChildren(el('div', { class: 'empty' }, 'No subscribers yet.'));

  main().replaceChildren(table(['Joined', 'Email', 'Source', 'Status'],
    data.map((s) => el('tr', {},
      el('td', { class: 'nowrap' }, fmtDate(s.created_at)),
      el('td', {}, el('a', { href: `mailto:${s.email}` }, s.email)),
      el('td', {}, s.source_page || '—'),
      el('td', {}, el('span', { class: `pill ${s.unsubscribed_at ? 'warn' : 'ok'}` },
        s.unsubscribed_at ? 'unsubscribed' : 'active'))))));
}

const table = (headers, rows) =>
  el('div', { class: 'scroll' },
    el('table', {},
      el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows)));

/* --------------------------------------------------------------- guides --- */

async function renderGuides() {
  const { data, error } = await supabase.from('guides').select('*').order('sort_order');
  if (error) return main().replaceChildren(el('div', { class: 'empty' }, error.message));

  main().replaceChildren(
    el('div', { class: 'listhead' },
      el('p', { class: 'muted' }, `${data.length} guide(s) — ${data.filter((g) => g.published).length} published`),
      isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: () => editGuide(null) }, '+ New guide') : null),
    el('div', { class: 'cards' },
      ...data.map((g) => el('button', { class: 'rowcard', onClick: () => editGuide(g) },
        el('div', {},
          el('strong', {}, g.title),
          el('small', {}, `/guides/${g.slug} · ${g.category} · ${g.read_time || '—'}`)),
        el('span', { class: `pill ${g.published ? 'ok' : 'warn'}` }, g.published ? 'published' : 'draft'))))
  );
}

async function editGuide(guide) {
  const isNew = !guide;
  const record = guide ?? {
    slug: '', title: '', category: 'Local SEO', excerpt: '', read_time: '5 min read',
    date_label: new Date().toLocaleString('en-CA', { month: 'long', year: 'numeric' }),
    takeaways: [], body_markdown: '', published: false, cover_media_id: null,
  };

  // The cover picker needs the library, so fetch it before building the form.
  let library = [];
  try { library = await listMedia(); } catch { /* picker just shows "none" */ }

  const fields = [
    ...GUIDE_FIELDS.filter((f) => f.name !== 'body_markdown' && f.name !== 'published'),
    { name: 'cover_media_id', label: 'Cover image', type: 'image', media: library,
      help: 'Shown on guide cards and at the top of the article. Upload images under Images first.' },
    ...GUIDE_FIELDS.filter((f) => f.name === 'body_markdown' || f.name === 'published'),
  ];
  const form = renderForm(fields, record);

  main().replaceChildren(
    el('div', { class: 'editorhead' },
      el('button', { class: 'back', onClick: renderGuides }, '← All guides'),
      el('div', { class: 'grow' }),
      !isNew && isAdmin
        ? el('button', { class: 'btn btn-ghost sm danger',
            onClick: () => deleteRecord('guides', 'slug', guide.slug, guide.title, renderGuides) }, 'Delete')
        : null,
      isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: submit }, isNew ? 'Create' : 'Save') : null),
    el('h2', {}, isNew ? 'New guide' : record.title),
    form.node
  );

  async function submit() {
    if (!guard()) return;
    const values = form.read();
    values.takeaways = toStrings(values.takeaways);
    if (!values.slug || !values.title) return toast('Title and slug are required.', 'bad');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug)) {
      return toast('Slug must be lowercase words separated by hyphens.', 'bad');
    }
    // A guide with no body is a draft whatever the checkbox says — otherwise it
    // would enter the sitemap pointing at an empty page.
    if (values.published && !values.body_markdown.trim()) {
      return toast('Write a body before publishing, or untick Published.', 'bad');
    }
    const ok = await save(
      () => supabase.from('guides').upsert({ ...values, sort_order: record.sort_order ?? 999 }, { onConflict: 'slug' }),
      isNew ? 'Guide created' : 'Guide saved'
    );
    if (ok) renderGuides();
  }
}

/* -------------------------------------------------------------- markets --- */

async function renderMarkets() {
  const { data, error } = await supabase.from('markets').select('*').order('sort_order');
  if (error) return main().replaceChildren(el('div', { class: 'empty' }, error.message));

  const search = el('input', { type: 'search', placeholder: 'Filter markets…', class: 'search' });
  const list = el('div', { class: 'cards' });

  const draw = (term = '') => {
    const t = term.toLowerCase();
    list.replaceChildren(...data
      .filter((m) => !t || `${m.city} ${m.region} ${m.country}`.toLowerCase().includes(t))
      .map((m) => el('button', { class: 'rowcard', onClick: () => editMarket(m) },
        el('div', {},
          el('strong', {}, `${m.city}, ${m.region}`),
          el('small', {}, `/markets/${m.slug} · ${m.country}`)),
        el('span', { class: `pill ${m.published ? 'ok' : 'warn'}` }, m.published ? 'live' : 'hidden'))));
  };
  search.addEventListener('input', () => draw(search.value));
  draw();

  main().replaceChildren(
    el('div', { class: 'listhead' },
      el('p', { class: 'muted' }, `${data.length} market page(s)`),
      isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: () => editMarket(null) }, '+ New market') : null),
    search, list);
}

function editMarket(market) {
  const isNew = !market;
  const record = market ?? {
    slug: '', city: '', region: '', country: 'Canada', kicker: 'Market page',
    h1: '', lede: '', blurb: '', seo_title: '', seo_desc: '',
    stats: [], whats: [], seasons: [], faqs: [], published: true,
  };
  const form = renderForm(MARKET_FIELDS, record);

  main().replaceChildren(
    el('div', { class: 'editorhead' },
      el('button', { class: 'back', onClick: renderMarkets }, '← All markets'),
      el('div', { class: 'grow' }),
      !isNew && isAdmin
        ? el('button', { class: 'btn btn-ghost sm danger',
            onClick: () => deleteRecord('markets', 'slug', market.slug, `${market.city}, ${market.region}`, renderMarkets) }, 'Delete')
        : null,
      isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: submit }, isNew ? 'Create' : 'Save') : null),
    el('h2', {}, isNew ? 'New market' : `${record.city}, ${record.region}`),
    form.node);

  async function submit() {
    if (!guard()) return;
    const values = form.read();
    if (!values.slug || !values.city) return toast('City and slug are required.', 'bad');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug)) {
      return toast('Slug must be lowercase words separated by hyphens.', 'bad');
    }
    const ok = await save(
      () => supabase.from('markets').upsert({ ...values, sort_order: record.sort_order ?? 999 }, { onConflict: 'slug' }),
      isNew ? 'Market created' : 'Market saved');
    if (ok) renderMarkets();
  }
}

/* ------------------------------------------------------------ page copy --- */

async function renderPages() {
  const { data, error } = await supabase.from('content_blocks').select('*').order('key');
  if (error) return main().replaceChildren(el('div', { class: 'empty' }, error.message));

  main().replaceChildren(
    el('p', { class: 'muted' }, 'Repeating copy across the site. Empty sections are hidden on the page rather than rendered blank.'),
    el('div', { class: 'cards' },
      ...data.map((b) => el('button', { class: 'rowcard', onClick: () => editBlock(b) },
        el('div', {}, el('strong', {}, b.label), el('small', {}, b.help || b.key)),
        el('span', { class: `pill ${(b.content || []).length ? '' : 'warn'}` },
          `${(b.content || []).length} item(s)`)))));
}

function editBlock(block) {
  const schema = BLOCK_SCHEMAS[block.key];
  if (!schema) {
    return main().replaceChildren(
      el('button', { class: 'back', onClick: renderPages }, '← Back'),
      el('div', { class: 'empty' }, `No editor defined for "${block.key}".`));
  }

  const editor = schema.simpleList
    ? renderSimpleList(toStrings(block.content), schema.itemLabel)
    : renderForm([{ name: 'content', label: block.label, type: 'repeater',
        itemLabel: schema.itemLabel, fields: schema.fields }], { content: block.content });

  main().replaceChildren(
    el('div', { class: 'editorhead' },
      el('button', { class: 'back', onClick: renderPages }, '← All page copy'),
      el('div', { class: 'grow' }),
      isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: submit }, 'Save') : null),
    el('h2', {}, block.label),
    block.help ? el('p', { class: 'muted' }, block.help) : null,
    editor.node);

  async function submit() {
    if (!guard()) return;
    // Simple lists round-trip as [{v}] so the templates can read either shape.
    const content = schema.simpleList
      ? editor.read().map((v) => ({ v }))
      : editor.read().content;
    const ok = await save(
      () => supabase.from('content_blocks').update({ content }).eq('key', block.key));
    if (ok) renderPages();
  }
}

/* --------------------------------------------------------------- images --- */

async function renderImages() {
  let slots, library;
  try {
    [slots, library] = await Promise.all([listSlots(), listMedia()]);
  } catch (err) {
    return main().replaceChildren(el('div', { class: 'empty' }, err.message));
  }

  const fileInput = el('input', {
    type: 'file', accept: 'image/*', multiple: true, hidden: true,
    onChange: async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      if (!guard()) return;

      const progress = $('upload-progress');
      let done = 0;
      for (const file of files) {
        progress.textContent = `Uploading ${file.name} (${done + 1} of ${files.length})…`;
        try {
          await uploadImage(file);
          done++;
        } catch (err) {
          toast(`${file.name}: ${err.message}`, 'bad');
        }
      }
      progress.textContent = '';
      if (done) {
        toast(`${done} image${done === 1 ? '' : 's'} uploaded`);
        refreshPublishState();
        renderImages();
      }
    },
  });

  const missingAlt = library.filter((m) => !m.alt.trim()).length;

  main().replaceChildren(
    el('div', { class: 'listhead' },
      el('p', { class: 'muted' },
        `${library.length} image(s) in the library.` +
        (missingAlt ? `  ${missingAlt} still need alt text.` : '')),
      isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: () => fileInput.click() }, '+ Upload images') : null),
    fileInput,
    el('p', { id: 'upload-progress', class: 'muted' }),
    el('p', { class: 'muted' },
      'Large photos are automatically resized to 2000px and compressed before upload, so a phone photo will not slow the site down.'),

    el('h2', {}, 'Page positions'),
    el('p', { class: 'muted' }, 'Where each image appears. An empty slot means that section renders without an image.'),
    el('div', { class: 'cards' }, ...slots.map((slot) => renderSlot(slot, library))),

    el('h2', {}, 'Library'),
    library.length
      ? el('div', { class: 'gallery' }, ...library.map((m) => renderMediaCard(m)))
      : el('div', { class: 'empty' }, 'Nothing uploaded yet. Use “Upload images” above.')
  );
}

function renderSlot(slot, library) {
  const select = el('select', {},
    el('option', { value: '' }, '— none —'),
    ...library.map((m) => el('option', {
      value: m.id, ...(m.id === slot.media_id ? { selected: true } : {}),
    }, `${m.path}${m.alt ? '' : '  (no alt text)'}`)));

  select.disabled = !isAdmin;
  select.addEventListener('change', async () => {
    if (!guard()) return;
    const ok = await save(
      () => supabase.from('image_slots').update({ media_id: select.value || null }).eq('key', slot.key),
      `${slot.label} updated`);
    if (ok) renderImages();
  });

  return el('div', { class: 'slotcard' },
    el('div', { class: 'slotpic' },
      slot.media
        ? el('img', { src: slot.media.url, alt: slot.media.alt || '', loading: 'lazy' })
        : el('span', { class: 'nopic' }, 'Empty')),
    el('div', { class: 'slotmeta' },
      el('strong', {}, slot.label),
      slot.help ? el('small', {}, slot.help) : null,
      select));
}

function renderMediaCard(m) {
  const altInput = el('input', { type: 'text', value: m.alt, placeholder: 'Describe the image…' });
  altInput.disabled = !isAdmin;
  altInput.addEventListener('change', async () => {
    if (!guard()) return;
    await save(() => supabase.from('media').update({ alt: altInput.value }).eq('id', m.id), 'Alt text saved');
  });

  return el('figure', { class: 'mediacard' },
    el('img', { src: m.url, alt: m.alt || '', loading: 'lazy' }),
    el('figcaption', {},
      altInput,
      el('small', {}, `${m.width}×${m.height} · ${formatBytes(m.bytes || 0)}`),
      isAdmin
        ? el('button', { class: 'icon danger', onClick: async () => {
            if (!confirm(`Delete this image? Any page using it will fall back to no image.`)) return;
            try {
              await deleteImage(m);
              toast('Image deleted');
              renderImages();
            } catch (err) { toast(err.message, 'bad'); }
          } }, 'Delete')
        : null));
}

/* ------------------------------------------------------------------ faq --- */

async function renderFaq() {
  const [{ data: groups, error: gErr }, { data: items, error: iErr }] = await Promise.all([
    supabase.from('faq_groups').select('*').order('sort_order'),
    supabase.from('faq_items').select('*').order('sort_order'),
  ]);
  if (gErr || iErr) return main().replaceChildren(el('div', { class: 'empty' }, (gErr || iErr).message));

  main().replaceChildren(
    el('p', { class: 'muted' }, 'Shown on /faq and emitted as FAQPage structured data.'),
    ...groups.map((g) => {
      const mine = items.filter((i) => i.group_id === g.id);
      const editor = renderForm([{
        name: 'items', label: g.name, type: 'repeater', itemLabel: 'question',
        fields: [
          { name: 'question', label: 'Question', type: 'text' },
          { name: 'answer', label: 'Answer', type: 'textarea' },
        ],
      }], { items: mine });

      return el('section', { class: 'faqgroup' },
        editor.node,
        isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: async () => {
          if (!guard()) return;
          const rows = editor.read().items.filter((r) => r.question?.trim());
          // Replace the group wholesale: simpler and safer than diffing, and
          // these lists are short.
          const ok = await save(async () => {
            const del = await supabase.from('faq_items').delete().eq('group_id', g.id);
            if (del.error) return del;
            if (!rows.length) return {};
            return supabase.from('faq_items').insert(
              rows.map((r, i) => ({ group_id: g.id, question: r.question, answer: r.answer, sort_order: i })));
          }, `${g.name} saved`);
          if (ok) renderFaq();
        } }, `Save ${g.name}`) : null);
    }));
}

/* -------------------------------------------------------------- reviews --- */

async function renderReviews() {
  const { data, error } = await supabase.from('reviews').select('*').order('sort_order');
  if (error) return main().replaceChildren(el('div', { class: 'empty' }, error.message));

  const editor = renderForm([{
    name: 'items', label: 'Reviews', type: 'repeater', itemLabel: 'review', fields: REVIEW_FIELDS,
  }], { items: data });

  main().replaceChildren(
    el('p', { class: 'muted' }, 'Shown on the homepage. Paste Google reviews verbatim.'),
    editor.node,
    isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: async () => {
      if (!guard()) return;
      const rows = editor.read().items.filter((r) => r.quote?.trim());
      const ok = await save(async () => {
        const del = await supabase.from('reviews').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (del.error) return del;
        if (!rows.length) return {};
        return supabase.from('reviews').insert(rows.map((r, i) => ({ ...r, sort_order: i })));
      });
      if (ok) renderReviews();
    } }, 'Save reviews') : null);
}

/* ---------------------------------------------------------------- menus --- */

async function renderMenus() {
  const { data, error } = await supabase.from('nav_links').select('*').order('sort_order');
  if (error) return main().replaceChildren(el('div', { class: 'empty' }, error.message));

  const build = (location, help) => {
    const editor = renderForm([{
      name: 'items', label: location === 'header' ? 'Header menu' : 'Footer menu',
      type: 'repeater', itemLabel: 'link',
      fields: location === 'header' ? NAV_FIELDS.filter((f) => f.name !== 'group_label') : NAV_FIELDS,
    }], { items: data.filter((l) => l.location === location) });

    return el('section', { class: 'faqgroup' },
      el('p', { class: 'muted' }, help),
      editor.node,
      isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: async () => {
        if (!guard()) return;
        const rows = editor.read().items.filter((r) => r.label?.trim() && r.href?.trim());
        const ok = await save(async () => {
          const del = await supabase.from('nav_links').delete().eq('location', location);
          if (del.error) return del;
          if (!rows.length) return {};
          return supabase.from('nav_links').insert(rows.map((r, i) => ({
            location, label: r.label, href: r.href,
            group_label: location === 'footer' ? r.group_label || 'Site' : null,
            sort_order: i,
          })));
        }, `${location} menu saved`);
        if (ok) renderMenus();
      } }, `Save ${location} menu`) : null);
  };

  main().replaceChildren(
    build('header', 'Order here is the order shown across the top of every page.'),
    build('footer', 'Links sharing a column heading are grouped together in the footer.'));
}

/* ------------------------------------------------------------- settings --- */

async function renderSettings() {
  const { data, error } = await supabase.from('site_settings').select('*');
  if (error) return main().replaceChildren(el('div', { class: 'empty' }, error.message));

  const byKey = Object.fromEntries(data.map((r) => [r.key, r.value]));
  const contact = byKey.contact ?? {};

  const contactForm = renderForm([
    { name: 'email', label: 'Email', type: 'text' },
    { name: 'phone', label: 'Phone (displayed)', type: 'text', width: 'sm' },
    { name: 'phone_href', label: 'Phone link', type: 'text', width: 'sm', help: 'e.g. tel:+19024884107' },
  ], contact);

  const blurb = renderForm([
    { name: 'footer_blurb', label: 'Footer blurb', type: 'textarea' },
  ], { footer_blurb: byKey.footer_blurb ?? '' });

  const brands = renderSimpleList(toStrings(byKey.brands), 'brand');

  main().replaceChildren(
    el('h2', {}, 'Contact details'),
    el('p', { class: 'muted' }, 'Used in the header, footer, contact page and structured data.'),
    contactForm.node,
    el('h2', {}, 'Footer'),
    blurb.node,
    el('h2', {}, 'Brand strip'),
    el('p', { class: 'muted' }, 'Shown under the homepage hero.'),
    brands.node,
    isAdmin ? el('button', { class: 'btn btn-primary sm', onClick: async () => {
      if (!guard()) return;
      const ok = await save(() => supabase.from('site_settings').upsert([
        { key: 'contact', value: contactForm.read() },
        { key: 'footer_blurb', value: blurb.read().footer_blurb },
        { key: 'brands', value: brands.read() },
      ], { onConflict: 'key' }), 'Settings saved');
      if (ok) renderSettings();
    } }, 'Save settings') : null);
}

/* ---------------------------------------------------------------- misc --- */

async function deleteRecord(table, keyCol, keyVal, label, after) {
  if (!guard()) return;
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
  const ok = await save(() => supabase.from(table).delete().eq(keyCol, keyVal), 'Deleted');
  if (ok) after();
}

/** Counts rows changed since the last publish, so Publish is never a guess. */
async function refreshPublishState() {
  const badge = $('pending');
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'last_published_at').maybeSingle();
  const since = data?.value;

  let changed = 0;
  await Promise.all(CONTENT_TABLES.map(async (t) => {
    let query = supabase.from(t).select('*', { count: 'exact', head: true });
    // The publish stamp lives in site_settings and is written *by* publishing,
    // so counting it would leave "1 unpublished change" on screen forever
    // immediately after every publish.
    if (t === 'site_settings') query = query.neq('key', 'last_published_at');
    const { count } = since ? await query.gt('updated_at', since) : await query;
    changed += count ?? 0;
  }));

  $('lastpub').textContent = since ? `Last published ${fmtDate(since)}` : 'Never published';
  if (changed > 0) {
    badge.textContent = `${changed} unpublished change${changed === 1 ? '' : 's'}`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

async function publish() {
  if (!guard()) return;
  const button = $('publish');
  button.disabled = true;
  button.textContent = 'Starting build…';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({}),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      toast('Build started — changes go live in a minute or two.');
      refreshPublishState();
    } else {
      toast(body.error || 'Could not start the build.', 'bad');
    }
  } catch {
    toast('Could not reach the publish endpoint.', 'bad');
  } finally {
    button.disabled = false;
    button.textContent = 'Publish';
  }
}

/* ----------------------------------------------------------------- boot --- */

export async function boot() {
  if (!configured) {
    $('boot').textContent =
      'Supabase is not configured for this build. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY, then redeploy.';
    return;
  }

  profile = await currentProfile();
  $('boot').hidden = true;
  if (!profile) {
    $('login').hidden = false;
    return;
  }
  isAdmin = profile.role === 'admin';

  $('app').hidden = false;
  $('who-email').textContent = profile.email;
  $('who-role').textContent = profile.role;
  $('readonly-note').hidden = isAdmin;
  $('publish').hidden = !isAdmin;

  $('snav').replaceChildren(...SECTIONS.map((s) =>
    el('button', { 'data-id': s.id, onClick: () => showSection(s.id) }, s.label)));
  $('publish').addEventListener('click', publish);
  $('signout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });

  const initial = SECTIONS.some((s) => s.id === location.hash.slice(1))
    ? location.hash.slice(1) : 'leads';
  showSection(initial);
  refreshPublishState();
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  const p = await currentProfile();
  if (!p) {
    await supabase.auth.signOut();
    return 'That account does not have access.';
  }
  return null;
}
