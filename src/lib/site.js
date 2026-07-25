// Single source of truth for business facts that appear in copy, structured
// data and the footer. Change the phone number here, not in eleven templates.

export const site = {
  name: 'Shawn Ryder Digital',
  url: 'https://shawnryder.com',
  email: 'shawn@shawnryder.com',
  phone: '902-488-4107',
  phoneHref: 'tel:+19024884107',
  phoneE164: '+1-902-488-4107',
  tagline: 'Digital marketing for car dealerships',
  description:
    'Digital marketing for car dealerships: local SEO, Google Business Profile, social media, email, reputation management and lead follow-up process.',
};

export const nav = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services' },
  { href: '/ai', label: 'AI' },
  { href: '/guides', label: 'Guides' },
  { href: '/markets', label: 'Markets' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

/** The ProfessionalService + Person graph, emitted once on every page. */
export const organizationSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'ProfessionalService',
      '@id': `${site.url}/#business`,
      name: site.name,
      url: site.url,
      description: site.description,
      email: site.email,
      telephone: site.phoneE164,
      priceRange: '$$',
      founder: { '@id': `${site.url}/#shawn` },
      areaServed: [
        { '@type': 'Country', name: 'Canada' },
        { '@type': 'Country', name: 'United States' },
      ],
      knowsAbout: [
        'Automotive SEO',
        'Google Business Profile optimization',
        'Dealership reputation management',
        'Automotive email marketing',
        'Dealership CRM follow-up process',
        'AI search visibility for dealerships',
      ],
    },
    {
      '@type': 'Person',
      '@id': `${site.url}/#shawn`,
      name: 'Shawn Ryder',
      jobTitle: 'Automotive Digital Marketing Consultant',
      email: site.email,
      telephone: site.phoneE164,
      worksFor: { '@id': `${site.url}/#business` },
      description:
        'Twenty-five years in the automotive industry — retail sales and dealership operations, now digital marketing for franchise and independent dealers across Canada and the United States.',
    },
  ],
};

/** Builds an FAQPage graph from [{ q, a }] — used on /faq and every market page. */
export function faqSchema(items) {
  if (!items?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}
