const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isConceptNoteProgressed(note) {
  return (note?.progressSignals || []).length > 0;
}

export function isConceptNoteWithinActiveWindow(note, referenceDay = new Date()) {
  const activeUntil = parseDay(note?.activeUntil);
  if (!activeUntil) return false;

  const comparison = new Date(Date.UTC(
    referenceDay.getFullYear(),
    referenceDay.getMonth(),
    referenceDay.getDate()
  ));

  return activeUntil >= comparison;
}

export function isConceptNoteActive(note, referenceDay = new Date()) {
  return isConceptNoteWithinActiveWindow(note, referenceDay) && !isConceptNoteProgressed(note);
}

export function getConceptNoteFrontstageState(note, referenceDay = new Date()) {
  if (isConceptNoteProgressed(note)) return 'progressed';
  if (isConceptNoteWithinActiveWindow(note, referenceDay)) return 'active';
  return 'all';
}

export function getConceptNoteSortDate(note) {
  const progressDates = [...(note?.progressSignals || [])]
    .map((signal) => signal?.date)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const latestProgressDate = progressDates[progressDates.length - 1];

  return latestProgressDate || note?.updatedAt || note?.createdAt || '';
}

export function getConceptNoteContributorNames(note, getPerson) {
  return (note?.contributors || [])
    .map((contributorId) => getPerson(contributorId)?.name || contributorId)
    .filter(Boolean);
}

export function getConceptNoteContributorLabel(note, getPerson) {
  const names = getConceptNoteContributorNames(note, getPerson);
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

export function getConceptNoteDaysUntilActiveEnds(note, referenceDay = new Date()) {
  const activeUntil = parseDay(note?.activeUntil);
  if (!activeUntil) return null;

  const comparison = new Date(Date.UTC(
    referenceDay.getFullYear(),
    referenceDay.getMonth(),
    referenceDay.getDate()
  ));

  return Math.floor((activeUntil.getTime() - comparison.getTime()) / DAY_MS);
}

export function isConceptNoteEndingSoon(note, days = 14, referenceDay = new Date()) {
  const remaining = getConceptNoteDaysUntilActiveEnds(note, referenceDay);
  return remaining != null && remaining <= days;
}

export function getConceptNoteProgressSummary(signal, getProject) {
  const projectTitle = signal?.projectId ? getProject(signal.projectId)?.title || signal.projectId : '';

  switch (signal?.kind) {
    case 'linked-project':
      return {
        label: 'Linked to related project',
        detail: projectTitle,
      };
    case 'connection-made':
      return {
        label: 'Connection made',
        detail: signal?.note || '',
      };
    case 'informed-discussion':
      return {
        label: 'Informed programme discussion',
        detail: signal?.note || '',
      };
    case 'taken-forward':
      if (signal?.targetType === 'new-project') {
        return {
          label: 'Taken forward as a new project',
          detail: signal?.note || '',
        };
      }
      if (signal?.targetType === 'work-package') {
        return {
          label: 'Taken forward in a work package',
          detail: signal?.note || '',
        };
      }
      return {
        label: 'Taken forward in project work',
        detail: projectTitle || signal?.note || '',
      };
    default:
      return {
        label: 'Progress recorded',
        detail: signal?.note || '',
      };
  }
}
