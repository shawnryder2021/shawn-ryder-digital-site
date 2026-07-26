// Generic form rendering. Reads a field schema, produces DOM, reads values back.
// Deliberately dependency-free: the admin is a single page and a framework would
// cost more bundle than it saves here.

export const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
};

/** A list of plain strings may be stored as ["a"] or [{v:"a"}]. Normalise both. */
export const toStrings = (arr) =>
  (Array.isArray(arr) ? arr : []).map((x) => (x && typeof x === 'object' ? x.v ?? '' : String(x ?? '')));

function labelled(field, control) {
  return el(
    'label',
    { class: `f f-${field.width || 'full'}` },
    el('span', {}, field.label),
    control,
    field.help ? el('small', { class: 'help' }, field.help) : null
  );
}

/** Renders one field and returns { node, read }. */
export function renderField(field, value) {
  if (field.type === 'checkbox') {
    const input = el('input', { type: 'checkbox', ...(value ? { checked: true } : {}) });
    return {
      node: el('label', { class: 'f f-check' }, input, el('span', {}, field.label),
        field.help ? el('small', { class: 'help' }, field.help) : null),
      read: () => input.checked,
    };
  }

  if (field.type === 'select') {
    const select = el('select', {},
      ...field.options.map((o) => el('option', { value: o, ...(o === value ? { selected: true } : {}) }, o)));
    return { node: labelled(field, select), read: () => select.value };
  }

  if (field.type === 'textarea' || field.type === 'markdown') {
    const ta = el('textarea', { rows: field.type === 'markdown' ? 22 : 3,
      ...(field.type === 'markdown' ? { class: 'mono' } : {}) });
    ta.value = value ?? '';
    return { node: labelled(field, ta), read: () => ta.value };
  }

  if (field.type === 'list') {
    const list = renderSimpleList(toStrings(value), field.itemLabel || 'item');
    return {
      node: el('div', { class: 'f f-full' },
        el('span', { class: 'flabel' }, field.label),
        field.help ? el('small', { class: 'help' }, field.help) : null,
        list.node),
      read: list.read,
    };
  }

  if (field.type === 'repeater') {
    const rep = renderRepeater(field, Array.isArray(value) ? value : []);
    return { node: rep.node, read: rep.read };
  }

  // Picks an existing library image. `field.media` is the library, supplied by
  // the caller so the picker does not fetch on every field render.
  if (field.type === 'image') {
    const select = el('select', {},
      el('option', { value: '' }, '— none —'),
      ...(field.media || []).map((m) =>
        el('option', { value: m.id, ...(m.id === value ? { selected: true } : {}) },
          `${m.path}${m.alt ? ` — ${m.alt}` : ' — (no alt text)'}`)));

    const preview = el('div', { class: 'imgpreview' });
    const paint = () => {
      const chosen = (field.media || []).find((m) => m.id === select.value);
      preview.replaceChildren(
        chosen
          ? el('img', { src: chosen.url, alt: chosen.alt || '', loading: 'lazy' })
          : el('span', { class: 'nopic' }, 'No image selected')
      );
    };
    select.addEventListener('change', paint);
    paint();

    return {
      node: el('div', { class: 'f f-full' },
        el('span', { class: 'flabel' }, field.label),
        field.help ? el('small', { class: 'help' }, field.help) : null,
        preview, select),
      read: () => select.value || null,
    };
  }

  const input = el('input', { type: field.type === 'number' ? 'number' : 'text' });
  input.value = value ?? '';
  return { node: labelled(field, input), read: () => input.value };
}

/** Array of plain strings — one input per row, add/remove/reorder. */
export function renderSimpleList(values, itemLabel) {
  const rows = el('div', { class: 'rows' });
  const readers = [];

  const addRow = (val = '') => {
    const input = el('input', { type: 'text' });
    input.value = val;
    const reader = () => input.value;
    readers.push(reader);
    const row = el('div', { class: 'row' },
      input,
      el('button', { type: 'button', class: 'icon', title: 'Move up',
        onClick: () => move(row, -1) }, '↑'),
      el('button', { type: 'button', class: 'icon', title: 'Move down',
        onClick: () => move(row, 1) }, '↓'),
      el('button', { type: 'button', class: 'icon danger', title: 'Remove',
        onClick: () => { readers.splice(readers.indexOf(reader), 1); row.remove(); } }, '×'));
    row._read = reader;
    rows.append(row);
  };

  const move = (row, dir) => {
    const all = [...rows.children];
    const i = all.indexOf(row);
    const j = i + dir;
    if (j < 0 || j >= all.length) return;
    dir < 0 ? rows.insertBefore(row, all[j]) : rows.insertBefore(all[j], row);
  };

  values.forEach(addRow);

  return {
    node: el('div', { class: 'listbox' }, rows,
      el('button', { type: 'button', class: 'add', onClick: () => addRow() }, `+ Add ${itemLabel}`)),
    // Read in DOM order so reordering is respected.
    read: () => [...rows.children].map((r) => r._read()).filter((v) => v.trim() !== ''),
  };
}

/** Array of objects — a card per item, each rendering the child field schema. */
export function renderRepeater(field, items) {
  const wrap = el('div', { class: 'rep' });

  const addItem = (item = {}) => {
    const readers = {};
    const body = el('div', { class: 'repbody' });
    for (const f of field.fields) {
      const { node, read } = renderField(f, item[f.name]);
      readers[f.name] = read;
      body.append(node);
    }
    const card = el('div', { class: 'repcard' },
      el('div', { class: 'rephead' },
        el('span', { class: 'repnum' }),
        el('button', { type: 'button', class: 'icon', title: 'Move up', onClick: () => move(card, -1) }, '↑'),
        el('button', { type: 'button', class: 'icon', title: 'Move down', onClick: () => move(card, 1) }, '↓'),
        el('button', { type: 'button', class: 'icon danger', title: 'Remove',
          onClick: () => { card.remove(); renumber(); } }, 'Remove')),
      body);
    card._read = () => Object.fromEntries(Object.entries(readers).map(([k, r]) => [k, r()]));
    wrap.append(card);
    renumber();
  };

  const move = (card, dir) => {
    const all = [...wrap.children];
    const i = all.indexOf(card);
    const j = i + dir;
    if (j < 0 || j >= all.length) return;
    dir < 0 ? wrap.insertBefore(card, all[j]) : wrap.insertBefore(all[j], card);
    renumber();
  };

  const renumber = () => {
    [...wrap.children].forEach((c, i) => {
      c.querySelector('.repnum').textContent = `${field.itemLabel || 'Item'} ${i + 1}`;
    });
  };

  items.forEach(addItem);

  return {
    node: el('div', { class: 'f f-full' },
      el('span', { class: 'flabel' }, field.label),
      field.help ? el('small', { class: 'help' }, field.help) : null,
      wrap,
      el('button', { type: 'button', class: 'add',
        onClick: () => addItem() }, `+ Add ${field.itemLabel || 'item'}`)),
    read: () => [...wrap.children].map((c) => c._read()),
  };
}

/** Builds a whole form from a field list. Returns { node, read }. */
export function renderForm(fields, record = {}) {
  const readers = {};
  const grid = el('div', { class: 'fields' });
  for (const f of fields) {
    const { node, read } = renderField(f, record[f.name]);
    readers[f.name] = read;
    grid.append(node);
  }
  return {
    node: grid,
    read: () => Object.fromEntries(Object.entries(readers).map(([k, r]) => [k, r()])),
  };
}
