// Guide outline generator UI
import { el } from './dom.js';

export function renderOutlineGenerator({ title, category, excerpt, onUse, guard }) {
  const container = el('div', { class: 'outline-generator' });
  const status = el('div', { class: 'outline-status' });
  const outline = el('div', { class: 'outline-display' });

  let currentOutline = null;

  const generate = async () => {
    if (!guard()) return;
    if (!title()) {
      status.textContent = 'Add a title first.';
      return;
    }

    status.textContent = 'Generating outline...';
    outline.innerHTML = '';

    try {
      const token = localStorage.getItem('sb-token');
      const response = await fetch('/api/generate-guide-outline', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title(),
          category: category(),
          excerpt: excerpt(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate outline');
      }

      const data = await response.json();
      currentOutline = data.outline;

      status.textContent = '';
      renderOutline(currentOutline);
    } catch (error) {
      status.textContent = `Error: ${error.message}`;
    }
  };

  const renderOutline = (sections) => {
    outline.innerHTML = '';

    if (typeof sections === 'string') {
      outline.appendChild(el('pre', { class: 'outline-raw' }, sections));
      return;
    }

    if (!Array.isArray(sections)) return;

    sections.forEach((section, i) => {
      const item = el(
        'div',
        { class: 'outline-item' },
        el('h3', {}, section.heading || `Section ${i + 1}`),
        el(
          'ul',
          {},
          ...(section.bullets || []).map((bullet) => el('li', {}, bullet))
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'outline-insert-btn',
            onClick: () => insertSection(section),
          },
          'Insert into body'
        )
      );
      outline.appendChild(item);
    });
  };

  const insertSection = (section) => {
    if (onUse) {
      onUse({
        heading: section.heading,
        bullets: section.bullets,
      });
    }
  };

  container.appendChild(
    el(
      'div',
      { class: 'outline-controls' },
      el('button', { type: 'button', class: 'btn-small', onClick: generate }, '✨ Generate outline'),
      status
    )
  );
  container.appendChild(outline);

  return container;
}
