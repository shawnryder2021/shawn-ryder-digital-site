// Email sequence generator UI
import { el } from './dom.js';

export function renderEmailGenerator({ guard }) {
  const container = el('div', { class: 'email-generator' });
  const status = el('div', { class: 'email-status' });
  const display = el('div', { class: 'email-display' });

  const scenarios = [
    { value: 'post-sale', label: 'Post-Sale Follow-Up' },
    { value: 'service', label: 'Service Appointment Follow-Up' },
    { value: 'review-request', label: 'Review Request Sequence' },
  ];

  const scenarioSelect = el('select', { class: 'scenario-select' });
  scenarios.forEach((s) => {
    scenarioSelect.appendChild(el('option', { value: s.value }, s.label));
  });

  const generate = async () => {
    if (!guard()) return;

    status.textContent = 'Generating emails...';
    display.innerHTML = '';

    try {
      const token = localStorage.getItem('sb-token');
      const response = await fetch('/api/generate-email-sequence', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scenario: scenarioSelect.value,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate emails');
      }

      const data = await response.json();
      status.textContent = '';
      renderEmails(data);
    } catch (error) {
      status.textContent = `Error: ${error.message}`;
    }
  };

  const renderEmails = (data) => {
    display.innerHTML = '';

    if (typeof data.emails === 'string') {
      display.appendChild(el('pre', { class: 'email-raw' }, data.emails));
      return;
    }

    if (!Array.isArray(data.emails)) return;

    const header = el('div', { class: 'email-sequence-header' }, el('h4', {}, data.title || 'Email Sequence'));
    display.appendChild(header);

    data.emails.forEach((email, i) => {
      const timing = email.timing || email.day || `Email ${i + 1}`;
      const card = el(
        'div',
        { class: 'email-card' },
        el('div', { class: 'email-timing' }, timing),
        el('div', { class: 'email-subject' }, `Subject: ${email.subject}`),
        el('div', { class: 'email-body' }, email.body),
        el(
          'button',
          {
            type: 'button',
            class: 'email-copy-btn',
            onClick: () => copyEmail(email),
          },
          'Copy'
        )
      );
      display.appendChild(card);
    });
  };

  const copyEmail = (email) => {
    const text = `Subject: ${email.subject}\n\n${email.body}`;
    navigator.clipboard.writeText(text);
  };

  container.appendChild(
    el(
      'div',
      { class: 'email-controls' },
      scenarioSelect,
      el('button', { type: 'button', class: 'btn-small', onClick: generate }, '✉️ Generate emails'),
      status
    )
  );
  container.appendChild(display);

  return container;
}
