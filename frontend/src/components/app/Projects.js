import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronRight, X, Plus } from 'lucide-react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { SectionNotice, SectionSkeleton } from './SectionState';
import SearchableSelect from './SearchableSelect';
import TagSelect from './TagSelect';
import TimelineExperiment from './TimelineExperiment';
import { formatDate } from '../../lib/constants';
import { buildProjectTeamPayload, getProjectLeadId, getProjectTeamMemberIds } from '../../lib/projectTeam';
import {
  canAccessProjectReview,
  compareDateStringsAsc,
  compareDateStringsDesc,
  getProjectActivityLabel,
  getProjectReviewSnapshot,
} from '../../lib/projectReview';
import { canCreateProjects, getLinkedPerson } from '../../lib/roleAccess';
import { matchesSearchQuery } from '../../lib/search';

const PROGRAMME_START = new Date(2024, 0, 1);
const PROGRAMME_END = new Date(2029, 11, 31);
const TIMELINE_RANGE_OPTIONS = [
  { value: '6m', label: '6 months' },
  { value: '12m', label: '12 months' },
  { value: '3y', label: '3 years' },
  { value: 'programme', label: 'Programme' },
];
const DEFAULT_REVIEW_STATE = {
  label: '',
  bucket: 'quiet',
  rank: 99,
  tone: 'neutral',
  detail: '',
};
const DEFAULT_FRESHNESS_CUE = {
  bucket: 'quiet',
  rank: 99,
  headline: '',
  detail: '',
};

function parseMilestoneDate(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function getTimelineWindow(range, referenceDate = new Date()) {
  const currentMonth = startOfMonth(referenceDate);

  switch (range) {
    case '12m':
      return {
        start: new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 5, 1),
        end: endOfMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 6, 1)),
      };
    case '3y':
      return {
        start: new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 17, 1),
        end: endOfMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 18, 1)),
      };
    case 'programme':
      return {
        start: new Date(PROGRAMME_START),
        end: new Date(PROGRAMME_END),
      };
    case '6m':
    default:
      return {
        start: new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 2, 1),
        end: endOfMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 3, 1)),
      };
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'overdue':
      return 'Delayed';
    case 'approaching':
      return 'Approaching';
    case 'completed':
      return 'Completed';
    default:
      return 'Scheduled';
  }
}

function formatTimelineMonthLabel(date, showYear = false) {
  return date.toLocaleDateString('en-GB', showYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
}

function buildMonthMarkerLabel(date, showYear = false) {
  return {
    label: formatTimelineMonthLabel(date, showYear),
    primaryLabel: date.toLocaleDateString('en-GB', { month: 'short' }),
    secondaryLabel: showYear ? date.toLocaleDateString('en-GB', { year: 'numeric' }) : '',
  };
}

function buildTimelineMarkers(start, end, stepMonths, formatLabel) {
  const markers = [];
  const current = new Date(start);
  while (current < start) {
    current.setMonth(current.getMonth() + stepMonths);
  }
  while (current <= end) {
    const formatted = formatLabel(new Date(current), markers[markers.length - 1]?.date || null);
    markers.push({
      date: new Date(current),
      ...(typeof formatted === 'string'
        ? { label: formatted, primaryLabel: formatted, secondaryLabel: '' }
        : formatted),
    });
    current.setMonth(current.getMonth() + stepMonths);
  }
  return markers;
}

function getChallengeSeverityLabel(severity) {
  switch (severity) {
    case 'blocking':
      return 'Blocking';
    case 'slowing':
      return 'Slowing';
    case 'minor':
      return 'Slowing';
    default:
      return 'Active';
  }
}

function getSafeReviewState(reviewSnapshot) {
  return reviewSnapshot?.reviewState || DEFAULT_REVIEW_STATE;
}

function getSafeFreshnessCue(freshnessCue) {
  return freshnessCue || DEFAULT_FRESHNESS_CUE;
}

function compareProjectsByHealthOrder(a, b) {
  const rankDiff = getSafeReviewState(a.reviewSnapshot).rank - getSafeReviewState(b.reviewSnapshot).rank;
  if (rankDiff !== 0) return rankDiff;

  const severityDiff = getReviewSeverityScore(a.reviewSnapshot) - getReviewSeverityScore(b.reviewSnapshot);
  if (severityDiff !== 0) return severityDiff;

  const blockingDiff = (b.reviewSnapshot?.challengeSnapshot?.blockingCount ?? 0) - (a.reviewSnapshot?.challengeSnapshot?.blockingCount ?? 0);
  if (blockingDiff !== 0) return blockingDiff;

  const slowingDiff = (b.reviewSnapshot?.challengeSnapshot?.slowingCount ?? 0) - (a.reviewSnapshot?.challengeSnapshot?.slowingCount ?? 0);
  if (slowingDiff !== 0) return slowingDiff;

  const overdueDiff = (b.reviewSnapshot?.milestoneSnapshot?.overdueCount ?? 0) - (a.reviewSnapshot?.milestoneSnapshot?.overdueCount ?? 0);
  if (overdueDiff !== 0) return overdueDiff;

  const freshnessDiff = getSafeFreshnessCue(a.freshnessCue).rank - getSafeFreshnessCue(b.freshnessCue).rank;
  if (freshnessDiff !== 0) return freshnessDiff;

  const milestoneDiff = compareDateStringsAsc(a.nextMilestone?.dueDate || '9999-12-31', b.nextMilestone?.dueDate || '9999-12-31');
  if (milestoneDiff !== 0) return milestoneDiff;

  const activityDiff = compareDateStringsDesc(a.lastActivityDate, b.lastActivityDate);
  if (activityDiff !== 0) return activityDiff;

  return a.project.title.localeCompare(b.project.title);
}

function getChallengePriority(severity) {
  switch (severity) {
    case 'blocking':
      return 0;
    case 'slowing':
      return 1;
    case 'minor':
      return 1;
    default:
      return 2;
  }
}

function summarizeChallengeText(text, maxLength = 108) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function getChallengeColumn(challengeSnapshot) {
  const { items = [], primarySeverity = null } = challengeSnapshot || {};

  if (!items.length) {
    return {
      value: 'No active challenges',
      note: '',
      tone: 'neutral',
    };
  }

  const strongestChallenge = [...items].sort((a, b) => {
    const severityDiff = getChallengePriority(a.severity) - getChallengePriority(b.severity);
    if (severityDiff !== 0) return severityDiff;
    return 0;
  })[0];
  const severityLabel = getChallengeSeverityLabel(strongestChallenge?.severity);
  const moreCount = items.length - 1;

  return {
    value: items.length === 1 ? `${severityLabel} challenge` : `${items.length} active challenges`,
    note: `${summarizeChallengeText(strongestChallenge?.description || '')}${moreCount > 0 ? ` · +${moreCount} more` : ''}`,
    tone: primarySeverity === 'blocking' ? 'danger' : primarySeverity === 'slowing' || primarySeverity === 'minor' ? 'warning' : 'neutral',
  };
}

function getReviewSeverityScore(reviewSnapshot) {
  const challengeSnapshot = reviewSnapshot?.challengeSnapshot || {};
  const milestoneSnapshot = reviewSnapshot?.milestoneSnapshot || {};
  const blockingCount = challengeSnapshot.blockingCount || 0;
  const slowingCount = challengeSnapshot.slowingCount || 0;
  const overdueCount = milestoneSnapshot.overdueCount || 0;
  const approachingCount = milestoneSnapshot.approachingCount || 0;

  if (blockingCount > 0 && overdueCount > 0) return 0;
  if (blockingCount > 0) return 1;
  if (overdueCount > 0) return 2;
  if (slowingCount > 0) return 3;
  if (approachingCount > 0) return 4;
  return 5;
}

function groupByMonth(items) {
  const grouped = new Map();

  items.forEach((item) => {
    const key = (item.date || '').slice(0, 7) || 'unknown';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, groupItems]) => {
      const [year, month] = key.split('-');
      const label = month
        ? new Date(Number(year), Number(month) - 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
        : key;
      return { key, label, items: groupItems };
    });
}

const ACTIVITY_TYPE_LABELS = {
  feedback: 'Feedback',
  challenge: 'Challenge',
  'challenge-resolved': 'Resolved',
  'concept-note': 'Concept note',
  'profile-update': 'Profile',
  record: 'Project details',
  milestone: 'Milestone',
};

export default function Projects({
  onProjectClick,
  onPersonClick,
  onNavigate,
  mode = 'catalogue',
  panelOpen = false,
}) {
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const { showToast } = useToast();
  const { projects, milestones, activity, people, institutions, getInstitution, getPerson, getProject, loading, refreshResource, resourceStatus } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [catalogueSearch, setCatalogueSearch] = useState('');
  const [reviewView, setReviewView] = useState('health');
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewSavedView, setReviewSavedView] = useState('all');
  const [timelineSearch, setTimelineSearch] = useState('');
  const [timelineRange, setTimelineRange] = useState('6m');
  const [activitySearch, setActivitySearch] = useState('');
  const [showAddProject, setShowAddProject] = useState(false);
  const [addProjectForm, setAddProjectForm] = useState({
    title: '',
    leadId: '',
    contributorIds: [],
    institution: '',
    summary: '',
  });
  const [addProjectError, setAddProjectError] = useState('');
  const [addProjectSubmitting, setAddProjectSubmitting] = useState(false);

  const linkedPerson = getLinkedPerson(permissions, getPerson);
  const reviewAccess = canAccessProjectReview(permissions, linkedPerson);
  const canAddProject = canCreateProjects(permissions, linkedPerson);
  const requestedView = mode === 'review-only' ? 'review' : searchParams.get('view');
  const activeView = mode === 'review-only'
    ? 'review'
    : requestedView === 'teams'
      ? 'teams'
      : 'overview';
  const selectedProjectId = searchParams.get('project');

  useEffect(() => {
    if (reviewView === 'timeline-lab') {
      setReviewView('timeline');
    }
  }, [reviewView]);

  const setView = (nextView) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextView === 'overview') {
      nextParams.delete('view');
    } else {
      nextParams.set('view', nextView);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const resetAddProjectForm = () => {
    setAddProjectForm({
      title: '',
      leadId: '',
      contributorIds: [],
      institution: '',
      summary: '',
    });
    setAddProjectError('');
  };

  const personOptions = useMemo(() => (
    [...people]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((person) => ({ value: person.id, label: person.name }))
  ), [people]);

  const institutionOptions = useMemo(() => (
    [...institutions].sort((a, b) => a.name.localeCompare(b.name))
  ), [institutions]);

  const contributorOptions = useMemo(() => (
    personOptions.filter((option) => option.value !== addProjectForm.leadId)
  ), [addProjectForm.leadId, personOptions]);

  const handleCreateProject = async (event) => {
    event.preventDefault();
    setAddProjectError('');

    if (!addProjectForm.title.trim() || !addProjectForm.leadId || !addProjectForm.institution || !addProjectForm.summary.trim()) {
      setAddProjectError('Title, lead, institution, and summary are required.');
      return;
    }

    setAddProjectSubmitting(true);
    try {
      const payload = {
        title: addProjectForm.title.trim(),
        institution: addProjectForm.institution,
        summary: addProjectForm.summary.trim(),
        ...buildProjectTeamPayload(addProjectForm.leadId, addProjectForm.contributorIds),
      };
      const response = await api.post('/projects', payload);
      await refreshResource('projects');
      resetAddProjectForm();
      setShowAddProject(false);
      showToast('Project created');
      if (response?.data?.id) {
        navigate(`/projects/${response.data.id}`);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      setAddProjectError(error?.response?.data?.detail || 'Failed to create project. Please try again.');
      showToast('Failed to create project', 'error');
    } finally {
      setAddProjectSubmitting(false);
    }
  };

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => (
      matchesSearchQuery(
        catalogueSearch,
        project.title,
        project.description,
        project.abstract,
        getProjectTeamMemberIds(project)
          .map((personId) => getPerson(personId)?.name)
          .filter(Boolean)
      )
    ));
  }, [catalogueSearch, getPerson, projects]);

  const projectIndex = useMemo(() => (
    projects.map((project) => {
      const inst = getInstitution(project.institution);
      const lead = getPerson(getProjectLeadId(project));
      const reviewSnapshot = getProjectReviewSnapshot(project, milestones);
      const nextMilestone = reviewSnapshot.milestoneSnapshot.nextMilestone;
      const milestoneCount = reviewSnapshot?.milestoneSnapshot?.items?.length ?? 0;
      const lastActivityAuthor = reviewSnapshot.lastActivity?.author
        ? (getPerson(reviewSnapshot.lastActivity.author)?.name || reviewSnapshot.lastActivity.author)
        : '';

      return {
        project,
        inst,
        lead,
        reviewSnapshot,
        freshnessCue: reviewSnapshot.freshnessCue,
        nextMilestone,
        milestoneCount,
        lastActivityLabel: reviewSnapshot.lastActivity
          ? `${getProjectActivityLabel(reviewSnapshot.lastActivity.type)} · ${formatDate(reviewSnapshot.lastActivity.date)}${lastActivityAuthor ? ` · ${lastActivityAuthor}` : ''}`
          : 'No published activity yet',
        lastActivitySummary: reviewSnapshot.lastActivity
          ? `${getProjectActivityLabel(reviewSnapshot.lastActivity.type)}${lastActivityAuthor ? ` • ${lastActivityAuthor}` : ''}`
          : 'No published activity yet',
        lastActivityDate: reviewSnapshot.lastActivity?.date || '',
        nextMilestoneLabel: nextMilestone
          ? `${nextMilestone.title} · ${formatDate(nextMilestone.dueDate)}`
          : milestoneCount > 0 ? 'No upcoming milestone' : 'No milestone yet',
        nextMilestoneNote: nextMilestone
          ? `${formatDate(nextMilestone.dueDate)}${nextMilestone.computedStatus && nextMilestone.computedStatus !== 'on-track' ? ` • ${getStatusLabel(nextMilestone.computedStatus)}` : ''}`
          : '',
      };
    })
  ), [getInstitution, getPerson, milestones, projects]);

  const overviewCards = useMemo(() => (
    [...projectIndex]
      .filter(({ project }) => filteredProjects.some((candidate) => candidate.id === project.id))
      .sort((a, b) => {
      return a.project.title.localeCompare(b.project.title);
      })
  ), [filteredProjects, projectIndex]);

  const reviewSavedViews = useMemo(() => {
    const viewDefs = [
      { value: 'all', label: 'All' },
      { value: 'needs-attention', label: 'Worth a look' },
      { value: 'no-milestone', label: 'No milestone' },
    ];

    return viewDefs.map((view) => ({
      ...view,
      count: projectIndex.filter((row) => matchesReviewSavedView(row, view.value)).length,
    }));
  }, [projectIndex]);

  const projectIndexById = useMemo(
    () => new Map(projectIndex.map((row) => [row.project.id, row])),
    [projectIndex]
  );

  const reviewRows = useMemo(() => {
    const query = reviewSearch;
    const rows = projectIndex.filter((row) => {
      const { lead, reviewSnapshot, nextMilestone } = row;
      const reviewState = getSafeReviewState(reviewSnapshot);
      if (!matchesReviewSavedView(row, reviewSavedView)) {
        return false;
      }

      if (!matchesSearchQuery(
        query,
        row.project.title,
        row.project.description,
        lead?.name,
        reviewState.detail,
        row.freshnessCue?.detail,
        row.freshnessCue?.headline,
        nextMilestone?.title,
        row.lastActivitySummary,
        row.lastActivityLabel
      )) {
        return false;
      }

      return true;
    });

    return rows.sort(compareProjectsByHealthOrder);
  }, [projectIndex, reviewSavedView, reviewSearch]);

  const roadmapRows = useMemo(() => (
    milestones.map((milestone) => {
      const project = getProject(milestone.project);
      const lead = getPerson(getProjectLeadId(project));

      return {
        milestone,
        project,
        lead,
      };
    })
  ), [getPerson, getProject, milestones]);

  const filteredTimelineRows = useMemo(() => {
    const query = timelineSearch;

    return roadmapRows
      .filter((row) => matchesSearchQuery(
        query,
          row.milestone.title,
          row.project?.title,
          row.lead?.name,
          row.milestone.type,
          getStatusLabel(row.milestone.computedStatus),
          row.timingLabel,
          row.reviewNote
      ));
  }, [roadmapRows, timelineSearch]);

  const timelineWindow = useMemo(() => getTimelineWindow(timelineRange), [timelineRange]);

  const timelineRows = useMemo(() => {
    const query = timelineSearch;
    const groupedByProject = new Map();
    const allowedProjectRows = projectIndex.filter((row) => matchesReviewSavedView(row, reviewSavedView));
    const allowedProjectIds = new Set(allowedProjectRows.map((row) => row.project.id));

    allowedProjectRows.forEach((row) => {
      const shouldSeedProject = !query || matchesSearchQuery(
        query,
        row.project.title,
        row.project.description,
        row.lead?.name,
        getSafeReviewState(row.reviewSnapshot).detail,
        row.freshnessCue?.detail,
        row.freshnessCue?.headline,
        row.nextMilestone?.title,
        row.lastActivitySummary,
        row.lastActivityLabel
      );

      if (!shouldSeedProject) return;

      groupedByProject.set(row.project.id, {
        projectId: row.project.id,
        projectTitle: row.project.title,
        milestones: [],
        totalMilestoneCount: row.reviewSnapshot?.milestoneSnapshot?.items?.length ?? 0,
      });
    });

    filteredTimelineRows.forEach((row) => {
      if (!row.project) return;
      if (!allowedProjectIds.has(row.project.id)) return;
      if (!groupedByProject.has(row.project.id)) {
        const projectRow = projectIndexById.get(row.project.id);
        groupedByProject.set(row.project.id, {
          projectId: row.project.id,
          projectTitle: row.project.title,
          milestones: [],
          totalMilestoneCount: projectRow?.reviewSnapshot?.milestoneSnapshot?.items?.length ?? 0,
        });
      }
      groupedByProject.get(row.project.id).milestones.push(row.milestone);
    });

    const statusPriority = { overdue: 0, approaching: 1, 'on-track': 2, completed: 3 };

    return [...groupedByProject.values()]
      .map((group) => {
        const visibleMilestones = group.milestones
          .filter((milestone) => {
            const parsed = parseMilestoneDate(milestone.dueDate);
            return parsed && parsed >= timelineWindow.start && parsed <= timelineWindow.end;
          })
          .sort((a, b) => compareDateStringsAsc(a.dueDate, b.dueDate));

        const dates = visibleMilestones
          .map((milestone) => parseMilestoneDate(milestone.dueDate))
          .filter(Boolean);
        const minDate = dates.length ? new Date(Math.min(...dates)) : null;
        const maxDate = dates.length ? new Date(Math.max(...dates)) : null;
        const worstStatus = visibleMilestones.reduce((worst, milestone) => {
          const current = milestone.computedStatus || 'on-track';
          return (statusPriority[current] ?? 2) < (statusPriority[worst] ?? 2) ? current : worst;
        }, 'on-track');
        const labelledMilestoneIds = new Set(
          visibleMilestones
            .filter((milestone) => milestone.computedStatus === 'overdue' || milestone.computedStatus === 'approaching')
            .map((milestone) => milestone.id)
        );
        const nextUpcoming = visibleMilestones.find((milestone) => milestone.computedStatus !== 'completed');
        if (nextUpcoming) {
          labelledMilestoneIds.add(nextUpcoming.id);
        }

        return {
          ...group,
          milestones: visibleMilestones,
          minDate,
          maxDate,
          worstStatus,
          labelledMilestoneIds,
          isEmptyRow: visibleMilestones.length === 0,
          emptyMessage: group.totalMilestoneCount === 0 ? 'No milestones yet' : 'No milestones in this range',
        };
      })
      .sort((a, b) => {
        const aProjectRow = projectIndexById.get(a.projectId);
        const bProjectRow = projectIndexById.get(b.projectId);
        if (!aProjectRow || !bProjectRow) {
          return a.projectTitle.localeCompare(b.projectTitle);
        }
        return compareProjectsByHealthOrder(aProjectRow, bProjectRow);
      });
  }, [filteredTimelineRows, projectIndex, projectIndexById, reviewSavedView, timelineSearch, timelineWindow]);

  const timelineMarkers = useMemo(() => {
    const start = new Date(timelineWindow.start);
    const end = new Date(timelineWindow.end);

    if (timelineRange === 'programme') {
      return buildTimelineMarkers(
        startOfYear(start),
        end,
        12,
        (date) => ({
          label: date.toLocaleDateString('en-GB', { year: 'numeric' }),
          primaryLabel: date.toLocaleDateString('en-GB', { year: 'numeric' }),
          secondaryLabel: '',
        })
      );
    }

    if (timelineRange === '3y') {
      return buildTimelineMarkers(
        startOfMonth(start),
        end,
        3,
        (date, previousDate) => {
          const showYear = !previousDate || previousDate.getFullYear() !== date.getFullYear() || date.getMonth() === 0;
          return buildMonthMarkerLabel(date, showYear);
        }
      );
    }

    return buildTimelineMarkers(
      startOfMonth(start),
      end,
      1,
      (date, previousDate) => {
        const showYear = !previousDate || previousDate.getFullYear() !== date.getFullYear();
        return buildMonthMarkerLabel(date, showYear);
      }
    );
  }, [timelineRange, timelineWindow]);

  const filteredActivity = useMemo(() => {
    const query = activitySearch;

    return [...activity]
      .filter((item) => item.type !== 'feedback')
      .filter((item) => matchesSearchQuery(
        query,
          item.title,
          item.project,
          item.author,
          ACTIVITY_TYPE_LABELS[item.type] || getProjectActivityLabel(item.type),
          item.content
      ))
      .sort((a, b) => compareDateStringsDesc(a.date || '', b.date || ''));
  }, [activity, activitySearch]);

  const groupedActivity = useMemo(() => groupByMonth(filteredActivity), [filteredActivity]);

  const byProject = useMemo(() => {
    const roleOrder = { pi: 0, postdoc: 1, phd: 2, staff: 3 };
    return [...projectIndex]
      .filter(({ project }) => filteredProjects.some((candidate) => candidate.id === project.id))
      .sort((a, b) => {
        const activityDiff = compareDateStringsDesc(a.lastActivityDate, b.lastActivityDate);
        return activityDiff || a.project.title.localeCompare(b.project.title);
      })
      .map(({ project: proj, inst }) => {
        const leadIds = getProjectTeamMemberIds(proj);
        const allMembers = leadIds
          .map((id) => getPerson(id))
          .filter(Boolean)
          .sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9));
        const lead = allMembers[0] || null;
        const others = allMembers.slice(1);
        return { project: proj, inst, lead, others, memberCount: allMembers.length };
      })
      .filter((group) => group.memberCount > 0);
  }, [filteredProjects, getPerson, projectIndex]);

  if (loading && projects.length === 0) {
    return <SectionSkeleton cards={6} />;
  }

  if (projects.length === 0 && resourceStatus.projects.status === 'error') {
    return (
      <SectionNotice
        title="Project data is unavailable"
        message={resourceStatus.projects.error || 'The project portfolio could not be loaded.'}
        onRetry={() => refreshResource('projects')}
      />
    );
  }

  const overviewCatalogue = (
    <div className="projects-list">
      {overviewCards.map(({ project, lead }) => {
        const isActive = selectedProjectId === project.id;

        return (
          <button
            key={project.id}
            type="button"
            data-testid={`project-card-${project.id}`}
            className={`project-list-row ${isActive ? 'active' : ''}`}
            onClick={() => onProjectClick(project.id)}
          >
            <div className="project-list-main">
              <div className="project-list-title-row">
                <h3>{project.title}</h3>
                <ChevronRight size={16} className="project-list-chevron" aria-hidden="true" />
              </div>
              {lead && (
                <div className="project-list-meta">
                  <span className="project-list-lead">
                    Lead: {lead.name}
                  </span>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <section
      data-testid="projects-section"
      className={`section active ${panelOpen ? 'projects-panel-open' : ''} ${activeView === 'review' ? 'projects-review-mode' : ''}`}
    >
      {activeView !== 'review' && (
        <div className="section-controls">
          <div className="view-toggle">
            <button data-testid="projects-overview-view" className={`filter-btn ${activeView === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Overview</button>
            <button data-testid="projects-teams-view" className={`filter-btn ${activeView === 'teams' ? 'active' : ''}`} onClick={() => setView('teams')}>Teams</button>
          </div>
          <div className="search-box">
            <Search size={16} />
            <input data-testid="projects-search" type="text" placeholder="Search projects..." value={catalogueSearch} onChange={(e) => setCatalogueSearch(e.target.value)} />
          </div>
          {canAddProject && (
            <button
              type="button"
              className="action-btn small"
              onClick={() => {
                resetAddProjectForm();
                setShowAddProject(true);
              }}
            >
              <Plus size={14} /> Add Project
            </button>
          )}
        </div>
      )}

      {activeView === 'overview' && (
        <div className="projects-catalogue-pane">
          <div className="projects-list-scroll">
            {overviewCatalogue}
          </div>
        </div>
      )}

      {activeView === 'teams' && (
        <div className="projects-catalogue-pane">
          <div className="projects-list-scroll">
            <div className="project-team-catalogue">
              {byProject.map(({ project: proj, lead, others, memberCount }) => (
                <div key={proj.id} className="project-team-row">
                  <button
                    type="button"
                    className="project-team-title-row"
                    onClick={() => onProjectClick(proj.id)}
                  >
                    <div className="project-team-title-wrap">
                      <h3>{proj.title}</h3>
                      <ChevronRight size={16} className="project-team-chevron" aria-hidden="true" />
                    </div>
                    <span className="project-team-count">{memberCount} member{memberCount !== 1 ? 's' : ''}</span>
                  </button>

                  {lead && (
                    <div className="project-team-meta-line">
                      <span className="project-team-meta-label">Lead</span>
                      <button
                        type="button"
                        className="project-team-person-link project-team-person-link-lead"
                        onClick={() => onPersonClick(lead.id)}
                      >
                        {lead.name}
                      </button>
                    </div>
                  )}

                  {others.length > 0 && (
                    <div className="project-team-meta-line">
                      <span className="project-team-meta-label">Team</span>
                      <div className="project-team-person-list">
                        {others.map((person, index) => (
                          <React.Fragment key={person.id}>
                            <button
                              type="button"
                              className="project-team-person-link"
                              onClick={() => onPersonClick(person.id)}
                            >
                              {person.name}
                            </button>
                            {index < others.length - 1 ? (
                              <span className="project-team-person-sep" aria-hidden="true">·</span>
                            ) : null}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeView === 'review' && reviewAccess && (
        <div className="projects-review-shell">
          <div className="view-toggle projects-review-view-toggle">
            <button type="button" className={`filter-btn ${reviewView === 'health' ? 'active' : ''}`} onClick={() => setReviewView('health')}>Scan</button>
            <button type="button" className={`filter-btn ${reviewView === 'timeline' ? 'active' : ''}`} onClick={() => setReviewView('timeline')}>Timeline</button>
            <button type="button" className={`filter-btn ${reviewView === 'activity' ? 'active' : ''}`} onClick={() => setReviewView('activity')}>Activity Feed</button>
          </div>

          {reviewView === 'health' && (
            <>
              <div className="section-actions projects-review-toolbar">
                <div className="search-box section-search">
                  <Search size={16} />
                  <input type="text" placeholder="Search review queue..." value={reviewSearch} onChange={(e) => setReviewSearch(e.target.value)} />
                </div>
              </div>

              <div className="projects-review-saved-views" aria-label="Saved review views">
                {reviewSavedViews.map((view) => (
                  <button
                    key={view.value}
                    type="button"
                    className={`review-saved-view-btn ${reviewSavedView === view.value ? 'active' : ''}`}
                    onClick={() => setReviewSavedView(view.value)}
                  >
                    <span>{view.label}</span>
                    <span className="review-saved-view-count">{view.count}</span>
                  </button>
                ))}
              </div>

              <div className="projects-review-list">
                {reviewRows.length === 0 ? (
                  <div className="projects-review-empty">
                    <h4>No projects match these review filters.</h4>
                    <p>Try broadening the search or switching to a different review slice.</p>
                  </div>
                ) : (
                  <>
                    <div className="project-review-header" aria-hidden="true">
                      <div className="project-review-header-cell">Project name</div>
                      <div className="project-review-header-cell">Challenges</div>
                      <div className="project-review-header-cell">Next milestone</div>
                    </div>
                    {reviewRows.map(({ project, lead, reviewSnapshot, nextMilestone, nextMilestoneLabel, nextMilestoneNote }) => {
                      const challengeColumn = getChallengeColumn(reviewSnapshot?.challengeSnapshot);

                      return (
                        <button
                          key={project.id}
                          type="button"
                          className={`project-review-row ${selectedProjectId === project.id ? 'active' : ''}`}
                          onClick={() => onProjectClick(project.id)}
                        >
                          <div className="project-review-main">
                            <div className="project-review-title-row">
                              <h4>{project.title}</h4>
                            </div>
                            <div className="project-review-inline-meta">
                              <span className="project-review-inline-item">
                                <span className="project-review-inline-label">Lead</span>
                                <span className="project-review-inline-value">{lead ? lead.name : 'Not assigned'}</span>
                              </span>
                            </div>
                          </div>
                          <div className="project-review-column">
                            <span className={`project-review-column-value ${challengeColumn.tone} ${challengeColumn.note ? '' : 'subtle'}`}>{challengeColumn.value}</span>
                            {challengeColumn.note ? (
                              <span className="project-review-column-note">{challengeColumn.note}</span>
                            ) : null}
                          </div>
                          <div className="project-review-column">
                            <span className={`project-review-column-value ${nextMilestone ? '' : 'subtle'}`}>
                              {nextMilestone ? nextMilestone.title : nextMilestoneLabel}
                            </span>
                            {nextMilestone ? (
                              <span className="project-review-column-note">{nextMilestoneNote}</span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}

          {reviewView === 'timeline' && (
            <>
              <div className="section-actions projects-review-toolbar">
                <div className="timeline-range-switch" role="group" aria-label="Timeline range">
                  {TIMELINE_RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`review-saved-view-btn ${timelineRange === option.value ? 'active' : ''}`}
                      onClick={() => setTimelineRange(option.value)}
                    >
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
                <div className="search-box section-search">
                  <Search size={16} />
                  <input type="text" placeholder="Search milestones, projects, or leads..." value={timelineSearch} onChange={(e) => setTimelineSearch(e.target.value)} />
                </div>
              </div>

              <div className="projects-review-saved-views timeline-slicers" aria-label="Timeline slices">
                {reviewSavedViews.map((view) => (
                  <button
                    key={view.value}
                    type="button"
                    className={`review-saved-view-btn ${reviewSavedView === view.value ? 'active' : ''}`}
                    onClick={() => setReviewSavedView(view.value)}
                  >
                    <span>{view.label}</span>
                    <span className="review-saved-view-count">{view.count}</span>
                  </button>
                ))}
              </div>

              {timelineRows.length > 0 ? (
                <TimelineExperiment
                  timelineRows={timelineRows}
                  timelineMarkers={timelineMarkers}
                  timelineWindow={timelineWindow}
                  timelineRange={timelineRange}
                  onProjectClick={onProjectClick}
                  selectedProjectId={selectedProjectId}
                />
              ) : (
                <div className="roadmap-list-empty">
                  <h4>No roadmap rows match these filters</h4>
                  <p>Try broadening the saved view or clearing one of the current filters.</p>
                </div>
              )}
            </>
          )}

          {reviewView === 'activity' && (
            <>
              <div className="section-actions projects-review-toolbar">
                <div className="search-box section-search">
                  <Search size={16} />
                  <input type="text" placeholder="Search activity..." value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} />
                </div>
              </div>

              <div className="dash-activity-feed review-activity-feed">
                {filteredActivity.length === 0 ? (
                  <div className="projects-review-empty">
                    <h4>No activity matches this search.</h4>
                    <p>Try broadening the search or clearing the current query.</p>
                  </div>
                ) : (
                  <div className="dash-feed-scroll">
                    {groupedActivity.map((group) => (
                      <div key={group.key} className="dash-feed-month">
                        <div className="dash-feed-month-label">{group.label}</div>
                        {group.items.map((entry, index) => {
                          const isClickable = Boolean(entry.projectId) || entry.type === 'concept-note';
                          const handleClick = () => {
                            if (entry.projectId) {
                              onProjectClick(entry.projectId);
                            } else if (entry.type === 'concept-note' && onNavigate) {
                              onNavigate('conceptnotes');
                            }
                          };

                          return (
                            <div
                              key={`${group.key}-${index}`}
                              className={`activity-item${isClickable ? ' clickable' : ''}`}
                              onClick={isClickable ? handleClick : undefined}
                            >
                              <div className="activity-dot" />
                              <div className="activity-content">
                                <div className="activity-title">
                                  {ACTIVITY_TYPE_LABELS[entry.type] && (
                                    <span className="activity-type-label" data-type={entry.type}>
                                      {ACTIVITY_TYPE_LABELS[entry.type]}
                                    </span>
                                  )}
                                  {entry.title}
                                </div>
                                <div className="activity-meta">
                                  {entry.project && <>{entry.project} &bull; </>}
                                  {formatDate(entry.date)}
                                  {entry.author && <> &bull; {entry.author}</>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {showAddProject && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (addProjectSubmitting) return;
            resetAddProjectForm();
            setShowAddProject(false);
          }}
        >
          <div className="modal-content form-modal project-create-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add project">
            <button
              type="button"
              className="modal-close"
              onClick={() => {
                if (addProjectSubmitting) return;
                resetAddProjectForm();
                setShowAddProject(false);
              }}
              aria-label="Close add project form"
            >
              <X size={20} />
            </button>
            <h2>Add Project</h2>
            <p className="form-subtitle">Create the core project record first, then fill out the fuller project page afterwards.</p>
            {addProjectError && <div className="form-error-box">{addProjectError}</div>}
            <form onSubmit={handleCreateProject} className="cg-form">
              <div className="form-field">
                <label>Title</label>
                <input
                  type="text"
                  value={addProjectForm.title}
                  onChange={(event) => setAddProjectForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="e.g. Adaptive Fermentation Interfaces"
                  disabled={addProjectSubmitting}
                />
              </div>
              <div className="form-field">
                <label>Lead</label>
                <SearchableSelect
                  options={personOptions}
                  value={addProjectForm.leadId}
                  onChange={(value) => setAddProjectForm((current) => ({
                    ...current,
                    leadId: value,
                    contributorIds: current.contributorIds.filter((memberId) => memberId !== value),
                  }))}
                  placeholder="Select the project lead..."
                  disabled={addProjectSubmitting}
                />
              </div>
              <div className="form-field">
                <label>Project team <span className="form-optional">(optional)</span></label>
                <TagSelect
                  options={contributorOptions}
                  value={addProjectForm.contributorIds}
                  onChange={(value) => setAddProjectForm((current) => ({ ...current, contributorIds: value }))}
                  placeholder="Add contributor..."
                  disabled={addProjectSubmitting}
                />
              </div>
              <div className="form-field">
                <label>Institution</label>
                <select
                  value={addProjectForm.institution}
                  onChange={(event) => setAddProjectForm((current) => ({ ...current, institution: event.target.value }))}
                  disabled={addProjectSubmitting}
                >
                  <option value="">Select institution...</option>
                  {institutionOptions.map((institution) => (
                    <option key={institution.id} value={institution.id}>{institution.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Summary</label>
                <textarea
                  value={addProjectForm.summary}
                  onChange={(event) => setAddProjectForm((current) => ({ ...current, summary: event.target.value }))}
                  rows={4}
                  placeholder="Capture the working summary for this project record."
                  disabled={addProjectSubmitting}
                />
              </div>
              <div className="writing-form-actions">
                <button
                  type="button"
                  className="save-mode-btn tertiary"
                  onClick={() => {
                    resetAddProjectForm();
                    setShowAddProject(false);
                  }}
                  disabled={addProjectSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="save-mode-btn publish" disabled={addProjectSubmitting}>
                  {addProjectSubmitting ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function matchesReviewSavedView(row, view) {
  const reviewBucket = getSafeReviewState(row.reviewSnapshot).bucket;
  const freshnessBucket = getSafeFreshnessCue(row.freshnessCue).bucket;

  switch (view) {
    case 'needs-attention':
      return reviewBucket === 'needs-review';
    case 'needs-follow-up':
      return freshnessBucket === 'needs-follow-up';
    case 'quiet-for-a-while':
      return freshnessBucket === 'quiet-for-a-while';
    case 'newly-started':
      return freshnessBucket === 'newly-started';
    case 'no-milestone':
      return (row.milestoneCount ?? 0) === 0;
    case 'all':
    default:
      return true;
  }
}
