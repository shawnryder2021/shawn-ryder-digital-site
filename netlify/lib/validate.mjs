// Input validation. Everything that reaches the database goes through here
// first: trimmed, length-capped, and control characters stripped.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Trim, drop control characters, cap length. Returns '' for non-strings. */
export function str(value, max = 500) {
  if (typeof value !== 'string') return '';
  // Newlines survive in textareas; everything else in the C0/C1 range goes.
  return value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, max);
}

export function email(value) {
  const v = str(value, 254).toLowerCase();
  return EMAIL.test(v) ? v : '';
}

/** Array of short strings — used for the contact-page checklist. */
export function stringList(value, { maxItems = 20, maxLen = 200 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((v) => str(v, maxLen))
    .filter(Boolean);
}

/**
 * The honeypot: a field hidden from humans by CSS. Bots fill every input they
 * find, so any value here means discard. We return 200 anyway so the bot has
 * no signal that it was caught.
 */
export function isBot(body) {
  return Boolean(str(body.company_website, 200));
}

/**
 * Validates an audit request. Returns { values } or { errors }.
 * Only name and email are required — asking for more up front costs leads.
 */
export function auditRequest(body) {
  const values = {
    name: str(body.name, 120),
    dealership: str(body.dealership, 160),
    email: email(body.email),
    phone: str(body.phone, 40),
    message: str(body.message, 4000),
    checklist: stringList(body.checklist),
    source_page: str(body.source_page, 200),
    market_slug: str(body.market_slug, 80),
  };

  const errors = {};
  if (!values.name) errors.name = 'Tell me your name.';
  if (!values.email) errors.email = 'A valid email address is required.';

  return Object.keys(errors).length ? { errors } : { values };
}

export function subscription(body) {
  const values = {
    email: email(body.email),
    source_page: str(body.source_page, 200),
  };
  return values.email
    ? { values }
    : { errors: { email: 'A valid email address is required.' } };
}
