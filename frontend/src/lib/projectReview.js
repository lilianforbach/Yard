function toSortableDate(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  return value;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(toSortableDate(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatElapsedDays(days) {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function getDaysSince(value, referenceDate = new Date()) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  const diffMs = referenceDate.getTime() - parsed.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

const REVIEW_QUIET_DAYS = 45;
const REVIEW_FOLLOW_UP_DAYS = 75;

export function compareDateStringsDesc(a, b) {
  return toSortableDate(b).localeCompare(toSortableDate(a));
}

export function compareDateStringsAsc(a, b) {
  return toSortableDate(a).localeCompare(toSortableDate(b));
}

function isSurfacedEntry(entry) {
  return entry?.published !== false;
}

export function getProjectLastActivity(project, milestones = []) {
  const items = [];

  if (project.lastModified) {
    items.push({
      date: project.lastModified,
      type: 'record',
      title: 'Project details updated',
    });
  }

  (project.updates || []).forEach((entry) => {
    if (!isSurfacedEntry(entry)) return;
    items.push({
      date: entry.lastModified || entry.date,
      type: 'update',
      title: entry.title,
      author: entry.author,
    });
  });

  (project.currentChallenges || []).forEach((entry) => {
    if (!isSurfacedEntry(entry)) return;
    items.push({
      date: entry.lastModified || entry.date,
      type: 'challenge',
      severity: entry.severity,
      author: entry.raisedBy,
      title: entry.description,
    });
  });

  (project.resolvedChallenges || []).forEach((entry) => {
    if (!isSurfacedEntry(entry)) return;
    items.push({
      date: entry.resolvedDate || entry.lastModified || entry.date,
      type: 'challenge-resolved',
      severity: entry.severity,
      author: entry.resolvedBy,
      title: entry.description,
    });
  });

  items.sort((a, b) => compareDateStringsDesc(a.date, b.date));
  return items[0] || null;
}

export function getProjectMilestoneSnapshot(projectId, milestones) {
  const items = milestones
    .filter((milestone) => milestone.project === projectId)
    .sort((a, b) => compareDateStringsAsc(a.dueDate, b.dueDate));

  const overdueCount = items.filter((milestone) => milestone.computedStatus === 'overdue').length;
  const approachingCount = items.filter((milestone) => milestone.computedStatus === 'approaching').length;
  const completedCount = items.filter((milestone) => milestone.computedStatus === 'completed').length;
  const nextMilestone = items.find((milestone) => milestone.computedStatus !== 'completed') || null;

  return {
    items,
    nextMilestone,
    overdueCount,
    approachingCount,
    completedCount,
  };
}

export function getProjectChallengeSnapshot(project) {
  const items = (project.currentChallenges || [])
    .filter(isSurfacedEntry)
    .map((challenge) => ({
      ...challenge,
      severity: challenge.severity === 'minor' ? 'slowing' : challenge.severity,
    }));
  const blockingCount = items.filter((challenge) => challenge.severity === 'blocking').length;
  const slowingCount = items.filter((challenge) => challenge.severity === 'slowing').length;

  return {
    items,
    blockingCount,
    slowingCount,
    primarySeverity: blockingCount > 0 ? 'blocking' : slowingCount > 0 ? 'slowing' : null,
  };
}

export function getProjectFreshnessCue(project, milestones, referenceDate = new Date()) {
  const lastActivity = getProjectLastActivity(project, milestones);
  const milestoneSnapshot = getProjectMilestoneSnapshot(project.id, milestones);
  const challengeSnapshot = getProjectChallengeSnapshot(project);
  const freshnessDays = getDaysSince(lastActivity?.date, referenceDate);
  const hasPublishedActivity = Boolean(lastActivity?.date);
  const hasVisibleSetup = milestoneSnapshot.items.length > 0 || challengeSnapshot.items.length > 0;

  if (!hasPublishedActivity) {
    if (!hasVisibleSetup) {
      return {
        label: 'Newly started',
        bucket: 'newly-started',
        rank: 1,
        tone: 'info',
        detail: 'No published activity or milestones yet',
        freshnessDays: null,
      };
    }

    return {
      label: 'Needs follow-up',
      bucket: 'needs-follow-up',
      rank: 0,
      tone: 'warning',
      detail: 'Visible in review, but no published activity yet',
      freshnessDays: null,
    };
  }

  if (!milestoneSnapshot.nextMilestone && freshnessDays != null && freshnessDays >= REVIEW_QUIET_DAYS) {
    return {
      label: 'Needs follow-up',
      bucket: 'needs-follow-up',
      rank: 0,
      tone: 'warning',
      detail: `No milestone scheduled and no published activity for ${formatElapsedDays(freshnessDays)}`,
      freshnessDays,
    };
  }

  if (freshnessDays != null && freshnessDays >= REVIEW_FOLLOW_UP_DAYS) {
    return {
      label: 'Needs follow-up',
      bucket: 'needs-follow-up',
      rank: 0,
      tone: 'warning',
      detail: `No published activity for ${formatElapsedDays(freshnessDays)}`,
      freshnessDays,
    };
  }

  if (freshnessDays != null && freshnessDays >= REVIEW_QUIET_DAYS) {
    return {
      label: 'Quiet for a while',
      bucket: 'quiet-for-a-while',
      rank: 2,
      tone: 'neutral',
      detail: `No published activity for ${formatElapsedDays(freshnessDays)}`,
      freshnessDays,
    };
  }

  return {
    label: 'Current',
    bucket: 'current',
    rank: 3,
    tone: 'neutral',
    detail: freshnessDays == null ? '' : `Published activity ${formatElapsedDays(freshnessDays)} ago`,
    freshnessDays,
  };
}

export function getProjectReviewState(project, milestones) {
  const milestoneSnapshot = getProjectMilestoneSnapshot(project.id, milestones);
  const challengeSnapshot = getProjectChallengeSnapshot(project);

  if (challengeSnapshot.blockingCount > 0) {
    return {
      label: 'Needs attention',
      bucket: 'needs-review',
      rank: 0,
      tone: 'danger',
      detail: `${challengeSnapshot.blockingCount} blocking challenge${challengeSnapshot.blockingCount === 1 ? '' : 's'}`,
      milestoneSnapshot,
      challengeSnapshot,
    };
  }

  if (milestoneSnapshot.overdueCount > 0) {
    return {
      label: 'Needs attention',
      bucket: 'needs-review',
      rank: 0,
      tone: 'danger',
      detail: `${milestoneSnapshot.overdueCount} delayed milestone${milestoneSnapshot.overdueCount === 1 ? '' : 's'}`,
      milestoneSnapshot,
      challengeSnapshot,
    };
  }

  if (challengeSnapshot.slowingCount > 0) {
    return {
      label: 'Worth a look',
      bucket: 'review-soon',
      rank: 1,
      tone: 'warning',
      detail: `${challengeSnapshot.slowingCount} slowing challenge${challengeSnapshot.slowingCount === 1 ? '' : 's'}`,
      milestoneSnapshot,
      challengeSnapshot,
    };
  }

  if (milestoneSnapshot.approachingCount > 0) {
    return {
      label: 'Worth a look',
      bucket: 'review-soon',
      rank: 1,
      tone: 'warning',
      detail: `${milestoneSnapshot.approachingCount} milestone${milestoneSnapshot.approachingCount === 1 ? '' : 's'} approaching`,
      milestoneSnapshot,
      challengeSnapshot,
    };
  }

  return {
    label: '',
    bucket: 'quiet',
    rank: 2,
    tone: 'neutral',
    detail: milestoneSnapshot.nextMilestone ? `Next milestone: ${milestoneSnapshot.nextMilestone.title}` : 'No review point surfaced',
    milestoneSnapshot,
    challengeSnapshot,
  };
}

export function getProjectReviewSnapshot(project, milestones) {
  const lastActivity = getProjectLastActivity(project, milestones);
  const milestoneSnapshot = getProjectMilestoneSnapshot(project.id, milestones);
  const challengeSnapshot = getProjectChallengeSnapshot(project);
  const reviewState = getProjectReviewState(project, milestones);
  const freshnessCue = getProjectFreshnessCue(project, milestones);

  return {
    lastActivity,
    milestoneSnapshot,
    challengeSnapshot,
    reviewState,
    freshnessCue,
  };
}

export function getProjectActivityLabel(type) {
  switch (type) {
    case 'milestone':
      return 'Milestone';
    case 'feedback':
      return 'Feedback';
    case 'update':
      return 'Update';
    case 'challenge':
      return 'Challenge';
    case 'challenge-resolved':
      return 'Challenge resolved';
    case 'record':
      return 'Project details';
    default:
      return 'Activity';
  }
}

export function canAccessProjectReview(permissions, linkedPerson) {
  if (permissions?.isAdmin) return true;

  if (!linkedPerson) return false;

  if (linkedPerson.role === 'staff' || linkedPerson.role === 'coordinator' || linkedPerson.role === 'management') {
    return true;
  }

  if (linkedPerson.role === 'pi') {
    return true;
  }

  return false;
}
