import { compareDateStringsAsc, getProjectLastActivity } from './projectReview';
import { getProjectLeadId } from './projectTeam';
import {
  getConceptNoteContributorLabel,
  getConceptNoteDaysUntilActiveEnds,
  getConceptNoteSortDate,
  isConceptNoteActive,
  isConceptNoteEndingSoon,
  isConceptNoteProgressed,
} from './conceptNotes';

export const PROJECT_STALE_DAYS = 45;
export const NOTE_FOLLOW_UP_DAYS = 45;
export const PROFILE_STALE_DAYS = 90;

function parseDate(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getDaysSince(value, referenceDate = new Date()) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  const diffMs = referenceDate.getTime() - parsed.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function formatDaysAgo(days) {
  if (days == null) return '';
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function canAccessMaintenance(permissions) {
  return Boolean(permissions?.isAdmin);
}

export function getMissingProfileFields(person) {
  const missing = [];
  if (!person.researchDescription?.trim()) missing.push('research interests');
  if (!person.email?.trim()) missing.push('email');
  return missing;
}

export function getPersonLastUpdated(person) {
  const profileUpdates = person?.profileUpdates || [];
  const latestProfileUpdate = profileUpdates.length ? profileUpdates[profileUpdates.length - 1]?.date : '';
  return person?.lastModified || latestProfileUpdate || '';
}

export function getPersonTrustCue(person) {
  const missingFields = getMissingProfileFields(person);
  const lastUpdated = getPersonLastUpdated(person);
  const freshnessDays = getDaysSince(lastUpdated);

  if (missingFields.length > 0) {
    return {
      tone: 'warning',
      headline: `Missing ${missingFields.join(', ')}`,
      note: lastUpdated ? `Profile updated ${formatDaysAgo(freshnessDays)}` : 'No profile update yet',
      missingFields,
      freshnessDays,
      lastUpdated,
    };
  }

  if (!lastUpdated) {
    return {
      tone: 'neutral',
      headline: 'Profile is ready to use',
      note: 'Core profile fields are present.',
      missingFields,
      freshnessDays: null,
      lastUpdated: '',
    };
  }

  return {
    tone: freshnessDays != null && freshnessDays >= PROFILE_STALE_DAYS ? 'warning' : 'neutral',
    headline: `Profile updated ${formatDaysAgo(freshnessDays)}`,
    note: 'No missing core profile fields surfaced.',
    missingFields,
    freshnessDays,
    lastUpdated,
  };
}

export function getProjectTrustCue(project, milestones) {
  const lastActivity = getProjectLastActivity(project, milestones);
  const lastActivityDate = lastActivity?.date || project?.lastModified || '';
  const freshnessDays = getDaysSince(lastActivityDate);
  const missingFields = [];
  const hasLead = Boolean(getProjectLeadId(project));
  const hasMilestone = milestones.some((milestone) => milestone.project === project?.id);
  const hasAbstract = Boolean(project?.abstract?.trim());

  if (!hasLead) missingFields.push('lead');
  if (!hasMilestone) missingFields.push('milestone');
  if (!hasAbstract) missingFields.push('abstract');

  if (!lastActivity?.date) {
    return {
      tone: 'warning',
      headline: 'No published activity yet',
      note: missingFields.length > 0 ? `Still missing ${missingFields.join(', ')}` : 'Visible record, but nothing has been surfaced yet.',
      missingFields,
      freshnessDays: null,
      lastActivityDate,
      lastActivity,
    };
  }

  if (missingFields.length > 0) {
    return {
      tone: 'warning',
      headline: `Missing ${missingFields.join(', ')}`,
      note: `Latest surfaced activity ${formatDaysAgo(freshnessDays)}`,
      missingFields,
      freshnessDays,
      lastActivityDate,
      lastActivity,
    };
  }

  if (freshnessDays != null && freshnessDays >= PROJECT_STALE_DAYS) {
    return {
      tone: 'warning',
      headline: `Latest surfaced activity ${formatDaysAgo(freshnessDays)}`,
      note: 'Record may need a quieter refresh pass.',
      missingFields,
      freshnessDays,
      lastActivityDate,
      lastActivity,
    };
  }

  return {
    tone: 'neutral',
    headline: `Latest surfaced activity ${formatDaysAgo(freshnessDays)}`,
    note: 'No missing core record fields surfaced.',
    missingFields,
    freshnessDays,
    lastActivityDate,
    lastActivity,
  };
}

export function getConceptNoteTrustCue(note) {
  const freshnessDate = getConceptNoteSortDate(note);
  const freshnessDays = getDaysSince(freshnessDate);
  const daysUntilActiveEnds = getConceptNoteDaysUntilActiveEnds(note);
  const missingFields = [];

  if (!note?.nextSteps?.trim()) missingFields.push('next steps');
  if (!isConceptNoteProgressed(note) && !note?.activeUntil) missingFields.push('active window');

  if (isConceptNoteProgressed(note)) {
    return {
      tone: 'neutral',
      headline: freshnessDate ? `Progress recorded ${formatDaysAgo(freshnessDays)}` : 'Progress recorded',
      note: 'This note has a visible progress trace.',
      missingFields,
      freshnessDays,
      freshnessDate,
      daysUntilActiveEnds,
    };
  }

  if (missingFields.length > 0) {
    return {
      tone: 'warning',
      headline: `Missing ${missingFields.join(', ')}`,
      note: freshnessDate ? `Updated ${formatDaysAgo(freshnessDays)}` : 'No concept note update yet',
      missingFields,
      freshnessDays,
      freshnessDate,
      daysUntilActiveEnds,
    };
  }

  if (isConceptNoteEndingSoon(note)) {
    return {
      tone: 'warning',
      headline: daysUntilActiveEnds > 0 ? `Active window ends in ${daysUntilActiveEnds} days` : 'Active window ends today',
      note: 'Extend if the note still needs to stay in active view.',
      missingFields,
      freshnessDays,
      freshnessDate,
      daysUntilActiveEnds,
    };
  }

  if (freshnessDays != null && freshnessDays >= NOTE_FOLLOW_UP_DAYS) {
    return {
      tone: 'warning',
      headline: `Updated ${formatDaysAgo(freshnessDays)}`,
      note: 'Still worth a follow-up pass to keep the note current.',
      missingFields,
      freshnessDays,
      freshnessDate,
      daysUntilActiveEnds,
    };
  }

  return {
    tone: 'neutral',
    headline: freshnessDate ? `Updated ${formatDaysAgo(freshnessDays)}` : 'Current enough',
    note: daysUntilActiveEnds == null
      ? 'Next steps are recorded.'
      : daysUntilActiveEnds < 0
        ? 'The note is no longer in active view.'
        : `Active through ${note.activeUntil}.`,
    missingFields,
    freshnessDays,
    freshnessDate,
    daysUntilActiveEnds,
  };
}

export function getMaintenanceSnapshot({ people, projects, milestones, conceptNotes, getPerson }) {
  const profilesToComplete = people
    .map((person) => {
      const missingFields = getMissingProfileFields(person);
      const lastUpdated = getPersonLastUpdated(person);
      return {
        person,
        missingFields,
        lastUpdated,
        freshnessDays: getDaysSince(lastUpdated),
      };
    })
    .filter((item) => item.missingFields.length > 0)
    .sort((a, b) => {
      const missingDiff = b.missingFields.length - a.missingFields.length;
      if (missingDiff !== 0) return missingDiff;
      const freshnessA = a.freshnessDays ?? Number.MAX_SAFE_INTEGER;
      const freshnessB = b.freshnessDays ?? Number.MAX_SAFE_INTEGER;
      if (freshnessA !== freshnessB) return freshnessB - freshnessA;
      return a.person.name.localeCompare(b.person.name);
    });

  const projectsToRefresh = projects
    .map((project) => {
      const lastActivity = getProjectLastActivity(project, milestones);
      const referenceDate = lastActivity?.date || project.lastModified || '';
      const freshnessDays = getDaysSince(referenceDate);
      const lead = getPerson(getProjectLeadId(project));
      const hasActivity = Boolean(referenceDate);
      const needsRefresh = !hasActivity || freshnessDays >= PROJECT_STALE_DAYS;

      return {
        project,
        lead,
        lastActivity,
        freshnessDays,
        hasActivity,
        needsRefresh,
      };
    })
    .filter((item) => item.needsRefresh)
    .sort((a, b) => {
      if (a.hasActivity !== b.hasActivity) return a.hasActivity ? 1 : -1;
      const freshnessA = a.freshnessDays ?? Number.MAX_SAFE_INTEGER;
      const freshnessB = b.freshnessDays ?? Number.MAX_SAFE_INTEGER;
      if (freshnessA !== freshnessB) return freshnessB - freshnessA;
      return a.project.title.localeCompare(b.project.title);
    });

  const projectsWithoutMilestones = projects
    .filter((project) => !milestones.some((milestone) => milestone.project === project.id))
    .map((project) => ({
      project,
      lead: getPerson(getProjectLeadId(project)),
      lastActivity: getProjectLastActivity(project, milestones),
    }))
    .sort((a, b) => a.project.title.localeCompare(b.project.title));

  const notesToFollowUp = conceptNotes
    .filter((note) => isConceptNoteActive(note))
    .map((note) => {
      const freshnessDate = getConceptNoteSortDate(note);
      const freshnessDays = getDaysSince(freshnessDate);
      const missingNextSteps = !note.nextSteps?.trim();
      const activeEndingSoon = isConceptNoteEndingSoon(note);
      const needsFollowUp = missingNextSteps || activeEndingSoon || freshnessDays >= NOTE_FOLLOW_UP_DAYS;
      return {
        note,
        freshnessDate,
        freshnessDays,
        missingNextSteps,
        activeEndingSoon,
        daysUntilActiveEnds: getConceptNoteDaysUntilActiveEnds(note),
        needsFollowUp,
        contributorLabel: getConceptNoteContributorLabel(note, getPerson),
      };
    })
    .filter((item) => item.needsFollowUp)
    .sort((a, b) => {
      if (a.activeEndingSoon !== b.activeEndingSoon) return a.activeEndingSoon ? -1 : 1;
      if (a.missingNextSteps !== b.missingNextSteps) return a.missingNextSteps ? -1 : 1;
      const freshnessA = a.freshnessDays ?? Number.MAX_SAFE_INTEGER;
      const freshnessB = b.freshnessDays ?? Number.MAX_SAFE_INTEGER;
      if (freshnessA !== freshnessB) return freshnessB - freshnessA;
      return compareDateStringsAsc(a.freshnessDate, b.freshnessDate);
    });

  return {
    profilesToComplete,
    projectsToRefresh,
    projectsWithoutMilestones,
    notesToFollowUp,
  };
}
