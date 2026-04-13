export const EVENT_KIND_META = {
  community: {
    label: 'Community moment',
    note: 'A shared point where the programme comes together in person and current work becomes easier to discuss collectively.',
  },
  governance: {
    label: 'Governance moment',
    note: 'A recurring point where visible project state, challenges, and concept notes may shape wider programme discussion.',
  },
  external: {
    label: 'External-accountability moment',
    note: 'A high-stakes point where programme health and activity are visible to external advisors.',
  },
  specialist: {
    label: 'Specialist programme moment',
    note: 'A smaller cross-programme session for responsible research, inclusion, translation, or exploitation questions.',
  },
};

export const PROGRAMME_RHYTHM = [
  {
    id: 'researcher-meetings',
    title: 'Researchers Day',
    cadence: 'Quarterly',
    kind: 'community',
    note: 'In-person meetings rotating across the three partner institutions, where researchers share progress and open questions with the wider group.',
  },
  {
    id: 'management-committee',
    title: 'Management Committee',
    cadence: 'Quarterly',
    kind: 'governance',
    note: 'The broader management body, with one PI from each group, that reviews programme-wide progress, discusses emerging challenges, and makes collective decisions.',
  },
  {
    id: 'opcom',
    title: 'Operations Committee',
    cadence: 'Monthly',
    kind: 'governance',
    subtle: true,
    note: 'The small standing committee that handles operational matters, current issues, and the programme\'s day-to-day running. Meets monthly.',
  },
  {
    id: 'programme-day',
    title: 'Programme Day',
    cadence: 'Annual',
    kind: 'community',
    note: 'An internal-only day in workshop format focused on open questions, shared thinking, and cross-project discussion. No external audience.',
  },
  {
    id: 'annual-event',
    title: 'Annual Event',
    cadence: 'Annual',
    kind: 'community',
    note: 'The programme\'s annual conference-style gathering, open to external partners. A moment for presenting work and progress to a wider audience.',
  },
  {
    id: 'eab',
    title: 'External Advisory Board',
    cadence: 'Annual',
    kind: 'external',
    note: 'An independent panel of external advisors who review the programme\'s direction, outputs, and impact. This is a distinct annual review moment within the same wider annual cycle as the Annual Event.',
  },
  {
    id: 'specialist-reviews',
    title: 'RRI, EDI, and Exploitation',
    cadence: 'Twice yearly',
    kind: 'specialist',
    note: 'Dedicated meetings and working groups on responsible research practice, equality and inclusion, and the translation and exploitation of programme outputs.',
  },
];

export function getEventKind(event) {
  if (!event) return 'community';

  const explicitKind = event.kind || event.category;
  if (explicitKind && EVENT_KIND_META[explicitKind]) {
    return explicitKind;
  }

  const haystack = `${event.name || ''} ${event.description || ''}`.toLowerCase();

  if (/(external advisory|advisory board|\beab\b)/.test(haystack)) return 'external';
  if (/(management committee|operations committee|\bopcom\b)/.test(haystack)) return 'governance';
  if (/(rri|edi|exploitation)/.test(haystack)) return 'specialist';
  return 'community';
}

export function getEventKindMeta(eventOrKind) {
  const kind = typeof eventOrKind === 'string' ? eventOrKind : getEventKind(eventOrKind);
  return EVENT_KIND_META[kind] || EVENT_KIND_META.community;
}
