export const PERSON_LINK_TYPES = [
  { value: 'website', label: 'Personal website', placeholder: 'e.g. https://your-site.com' },
  { value: 'lab', label: 'Lab or group page', placeholder: 'e.g. https://lab.example.ac.uk' },
  { value: 'orcid', label: 'ORCID', placeholder: 'e.g. 0000-0001-2345-6789' },
  { value: 'scholar', label: 'Google Scholar', placeholder: 'e.g. scholar.google.com/citations?user=...' },
  { value: 'github', label: 'GitHub', placeholder: 'e.g. github.com/username or username' },
  { value: 'linkedin', label: 'LinkedIn', placeholder: 'e.g. linkedin.com/in/your-name' },
  { value: 'substack', label: 'Substack', placeholder: 'e.g. name.substack.com' },
  { value: 'other', label: 'Other', placeholder: 'e.g. https://example.com' },
];

const PERSON_LINK_TYPE_LOOKUP = new Map(PERSON_LINK_TYPES.map((option) => [option.value, option]));

export function normalizeHttpUrl(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

export function normalizeOrcidValue(orcid) {
  const trimmed = (orcid || '').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .replace(/^orcid\.org\//i, '')
    .replace(/\/+$/, '');
}

export function getOrcidUrl(orcid) {
  const normalized = normalizeOrcidValue(orcid);
  return normalized ? `https://orcid.org/${normalized}` : '';
}

export function normalizeGithubValue(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const normalized = trimmed.replace(/^@/, '').replace(/^github\.com\//i, '').replace(/^\/+/, '');
  return `https://github.com/${normalized}`;
}

export function normalizeSubstackValue(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const normalized = trimmed.replace(/^@/, '').replace(/^\/+/, '');
  if (/substack\.com$/i.test(normalized)) {
    return `https://${normalized}`;
  }
  return `https://${normalized}.substack.com`;
}

export function getPersonLinkType(type) {
  return PERSON_LINK_TYPE_LOOKUP.get(type) || PERSON_LINK_TYPE_LOOKUP.get('other');
}

export function getPersonLinkPlaceholder(type) {
  return getPersonLinkType(type)?.placeholder || 'e.g. https://example.com';
}

export function getPersonLinkLabel(linkOrType, customLabel = '') {
  if (typeof linkOrType === 'string') {
    if (linkOrType === 'other') return customLabel?.trim() || 'Other link';
    return getPersonLinkType(linkOrType)?.label || 'Link';
  }

  const link = linkOrType || {};
  if (link.type === 'other') return (link.label || '').trim() || 'Other link';
  return getPersonLinkType(link.type)?.label || 'Link';
}

export function normalizePersonLink(link) {
  const type = getPersonLinkType(link?.type)?.value || 'other';
  const label = (link?.label || '').trim();
  const rawUrl = (link?.url || '').trim();
  if (!rawUrl) return null;

  let url = rawUrl;
  if (type === 'orcid') url = getOrcidUrl(rawUrl);
  else if (type === 'github') url = normalizeGithubValue(rawUrl);
  else if (type === 'substack') url = normalizeSubstackValue(rawUrl);
  else url = normalizeHttpUrl(rawUrl);

  if (!url) return null;

  return {
    type,
    label: type === 'other' ? label : '',
    url,
  };
}

export function buildPersonLinks(person = {}) {
  const fromLinks = Array.isArray(person.links)
    ? person.links.map((link) => normalizePersonLink(link)).filter(Boolean)
    : [];

  if (fromLinks.length > 0) {
    return fromLinks;
  }

  return [
    normalizePersonLink({ type: 'website', url: person.website }),
    normalizePersonLink({ type: 'github', url: person.github }),
    normalizePersonLink({ type: 'substack', url: person.substack }),
    normalizePersonLink({ type: 'orcid', url: person.orcid }),
  ].filter(Boolean);
}

export function getLinkDisplayText(type, url) {
  if (!url) return '';
  if (type === 'orcid') return normalizeOrcidValue(url);

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, '');
    const pathname = parsed.pathname.replace(/\/$/, '');

    if (type === 'website') return hostname;
    if (!pathname || pathname === '/') return hostname;
    return `${hostname}${pathname}`;
  } catch {
    return url;
  }
}
