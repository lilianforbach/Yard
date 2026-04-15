import { canAccessMaintenance } from './maintenance';
import { getProjectLeadId, getProjectTeamMemberIds } from './projectTeam';
import { canAccessProjectReview } from './projectReview';

export const FEEDBACK_AUDIENCE_LABELS = {
  lead: 'Lead only',
  team: 'Project team',
};

export function normalizeFeedbackBaseAudience(value) {
  return value === 'lead' ? 'lead' : 'team';
}

export function normalizeFeedbackIncludeReviewers(value, includeReviewers = null) {
  if (typeof includeReviewers === 'boolean') return includeReviewers;
  return value === 'review';
}

export function getFeedbackAudienceState(entryOrAudience, maybeIncludeReviewers = null) {
  if (entryOrAudience && typeof entryOrAudience === 'object') {
    return {
      baseAudience: normalizeFeedbackBaseAudience(entryOrAudience.audience),
      includeReviewers: normalizeFeedbackIncludeReviewers(entryOrAudience.audience, entryOrAudience.includeReviewers),
    };
  }

  return {
    baseAudience: normalizeFeedbackBaseAudience(entryOrAudience),
    includeReviewers: normalizeFeedbackIncludeReviewers(entryOrAudience, maybeIncludeReviewers),
  };
}

export function getFeedbackAudienceBadges(entryOrAudience, maybeIncludeReviewers = null) {
  const { baseAudience, includeReviewers } = getFeedbackAudienceState(entryOrAudience, maybeIncludeReviewers);
  const badges = [FEEDBACK_AUDIENCE_LABELS[baseAudience] || FEEDBACK_AUDIENCE_LABELS.team];
  if (includeReviewers) badges.push('Review access');
  return badges;
}

export function getLinkedPerson(permissions, getPerson) {
  if (!permissions?.linkedPersonId || typeof getPerson !== 'function') return null;
  return getPerson(permissions.linkedPersonId) || null;
}

export function canOnboardMembers(permissions) {
  return Boolean(permissions?.isAdmin);
}

export function canCreateProjects(permissions, linkedPerson) {
  return Boolean(permissions?.isAdmin);
}

export function canCreateGlobalMilestones(permissions, linkedPerson, projects = []) {
  if (permissions?.isAdmin) return true;
  if (!linkedPerson?.id) return false;

  return projects.some((project) => {
    const leadId = getProjectLeadId(project);
    return Boolean(leadId && leadId === linkedPerson.id);
  });
}

export function getProjectSurfaceAccess({ permissions, linkedPerson, project }) {
  const projectMemberIds = getProjectTeamMemberIds(project);
  const leadId = getProjectLeadId(project) || null;
  const linkedId = linkedPerson?.id || null;
  const feedbackAuthorName = linkedPerson?.name || '';

  const isAdmin = Boolean(permissions?.isAdmin);
  const isProjectMember = Boolean(linkedId && projectMemberIds.includes(linkedId));
  const isLead = Boolean(linkedId && leadId && linkedId === leadId);
  const isProjectPi = Boolean(linkedId && linkedPerson?.role === 'pi' && projectMemberIds.includes(linkedId));
  const isContributor = Boolean(linkedId && projectMemberIds.includes(linkedId) && !isLead && !isProjectPi);
  const hasReviewAccess = canAccessProjectReview(permissions, linkedPerson);

  const canManageProjectContent = isAdmin || isLead;
  const canViewPrivateFeedback = isAdmin || isProjectMember;
  const canAddFeedback = Boolean(hasReviewAccess && !isLead);

  return {
    linkedPerson,
    isAdmin,
    isProjectMember,
    isLead,
    isProjectPi,
    isContributor,
    canManageProjectContent,
    canManageTeam: canManageProjectContent,
    canManageMilestones: canManageProjectContent,
    canManageChallenges: canManageProjectContent,
    canAddUpdate: canManageProjectContent,
    canAddFeedback,
    canViewPrivateFeedback,
    canAccessReview: hasReviewAccess,
    canAccessMaintenance: canAccessMaintenance(permissions, linkedPerson),
    canViewFeedbackEntry(entry) {
      if (!entry) return false;
      if (isAdmin) return true;
      if (feedbackAuthorName && entry.author === feedbackAuthorName) return true;

      const { baseAudience, includeReviewers } = getFeedbackAudienceState(entry);
      if (includeReviewers && hasReviewAccess) return true;
      if (baseAudience === 'lead') return isLead;
      return isProjectMember;
    },
    canEditProjectEntry(entry) {
      if (!entry?.entryType) return false;
      if (entry.entryType === 'updates') return isAdmin || isLead;
      if (entry.entryType === 'feedback') {
        if (isAdmin) return true;
        return Boolean(canAddFeedback && feedbackAuthorName && entry.author === feedbackAuthorName);
      }
      return false;
    },
  };
}
