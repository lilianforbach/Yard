import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronRight, X, Plus, Maximize2 } from 'lucide-react';
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
  canAccessProjectContext,
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

function getProjectContextSortDate(row) {
  return row.reviewSnapshot?.lastActivity?.date || row.project.lastModified || '';
}

function compareProjectsByRecentContext(a, b) {
  const activityDiff = compareDateStringsDesc(getProjectContextSortDate(a), getProjectContextSortDate(b));
  if (activityDiff !== 0) return activityDiff;

  const milestoneDiff = compareDateStringsAsc(a.nextMilestone?.dueDate || '9999-12-31', b.nextMilestone?.dueDate || '9999-12-31');
  if (milestoneDiff !== 0) return milestoneDiff;

  return a.project.title.localeCompare(b.project.title);
}

function compareProjectsByNextMilestone(a, b) {
  const milestoneDiff = compareDateStringsAsc(a.nextMilestone?.dueDate || '9999-12-31', b.nextMilestone?.dueDate || '9999-12-31');
  if (milestoneDiff !== 0) return milestoneDiff;

  return a.project.title.localeCompare(b.project.title);
}

function getChallengeColumn(challengeSnapshot) {
  const { items = [] } = challengeSnapshot || {};
  return [...items].sort((a, b) => {
    const dateDiff = compareDateStringsDesc(a.lastModified || a.date || '', b.lastModified || b.date || '');
    if (dateDiff !== 0) return dateDiff;
    return (a.description || '').localeCompare(b.description || '');
  });
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
  update: 'Update',
  challenge: 'Challenge',
  'challenge-resolved': 'Resolved',
  'concept-note': 'Concept note',
  milestone: 'Milestone',
  publication: 'Publication',
  event: 'Event',
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
  const reviewAccess = canAccessProjectContext(permissions);
  const canAddProject = canCreateProjects(permissions, linkedPerson);
  const requestedView = mode === 'review-only' ? 'review' : searchParams.get('view');
  const activeView = mode === 'review-only'
    ? 'review'
    : requestedView === 'teams'
      ? 'teams'
      : requestedView === 'mine'
        ? 'mine'
      : 'overview';
  const selectedProjectId = searchParams.get('project');

  const openFullProjectPage = (projectId) => {
    navigate(`/projects/${projectId}`);
  };

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
      (activeView !== 'mine' || Boolean(linkedPerson?.id && getProjectTeamMemberIds(project).includes(linkedPerson.id)))
      &&
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
  }, [activeView, catalogueSearch, getPerson, linkedPerson?.id, projects]);

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

  const projectIndexById = useMemo(
    () => new Map(projectIndex.map((row) => [row.project.id, row])),
    [projectIndex]
  );

  const reviewRows = useMemo(() => {
    const query = reviewSearch;
    const rows = projectIndex.filter((row) => {
      const { lead, nextMilestone } = row;

      if (!matchesSearchQuery(
        query,
        row.project.title,
        row.project.description,
        lead?.name,
        nextMilestone?.title,
        row.lastActivitySummary,
        row.lastActivityLabel
      )) {
        return false;
      }

      return true;
    });

    return rows.sort(compareProjectsByRecentContext);
  }, [projectIndex, reviewSearch]);

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
        getStatusLabel(row.milestone.computedStatus)
      ));
  }, [roadmapRows, timelineSearch]);

  const timelineWindow = useMemo(() => getTimelineWindow(timelineRange), [timelineRange]);

  const timelineRows = useMemo(() => {
    const query = timelineSearch;
    const groupedByProject = new Map();
    const allowedProjectRows = projectIndex;
    const allowedProjectIds = new Set(allowedProjectRows.map((row) => row.project.id));

    allowedProjectRows.forEach((row) => {
      const shouldSeedProject = !query || matchesSearchQuery(
        query,
        row.project.title,
        row.project.description,
        row.lead?.name,
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

    return [...groupedByProject.values()]
      .map((group) => {
        const visibleMilestones = group.milestones
          .filter((milestone) => {
            const parsed = parseMilestoneDate(milestone.dueDate);
            return parsed && parsed >= timelineWindow.start && parsed <= timelineWindow.end;
          })
          .sort((a, b) => compareDateStringsAsc(a.dueDate, b.dueDate));

        return {
          ...group,
          milestones: visibleMilestones,
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
        return compareProjectsByNextMilestone(aProjectRow, bProjectRow);
      });
  }, [filteredTimelineRows, projectIndex, projectIndexById, timelineSearch, timelineWindow]);

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
        item.context,
        item.author,
        ACTIVITY_TYPE_LABELS[item.type] || getProjectActivityLabel(item.type)
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
      {overviewCards.length === 0 && (
        <div className="projects-empty-state">
          <h4>{activeView === 'mine' ? 'No projects are linked to your profile yet.' : 'No projects match this search.'}</h4>
          <p>{activeView === 'mine' ? 'Projects appear here when your profile is listed as the lead or part of the project team.' : 'Try a different search term.'}</p>
        </div>
      )}
      {overviewCards.map(({ project, lead }) => {
        const isActive = selectedProjectId === project.id;

        return (
          <div
            key={project.id}
            data-testid={`project-card-${project.id}`}
            className={`project-list-row ${isActive ? 'active' : ''}`}
          >
            <button
              type="button"
              className="project-list-preview"
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
            <button
              type="button"
              className="project-list-open-page"
              onClick={() => openFullProjectPage(project.id)}
              aria-label={`Open full page for ${project.title}`}
            >
              <span className="project-list-open-page-label">Open full page</span>
              <Maximize2 size={13} aria-hidden="true" />
            </button>
          </div>
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
            <button data-testid="projects-mine-view" className={`filter-btn ${activeView === 'mine' ? 'active' : ''}`} onClick={() => setView('mine')}>My Projects</button>
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

      {(activeView === 'overview' || activeView === 'mine') && (
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
                  <input type="text" placeholder="Search project context..." value={reviewSearch} onChange={(e) => setReviewSearch(e.target.value)} />
                </div>
              </div>

              <p className="projects-review-helper-copy">
                Projects are shown by recent visible movement, with current challenges and milestones kept in view.
              </p>

              <div className="projects-review-list">
                {reviewRows.length === 0 ? (
                  <div className="projects-review-empty">
                    <h4>No projects match this search.</h4>
                    <p>Try broadening the search.</p>
                  </div>
                ) : (
                  <>
                    <div className="project-review-header" aria-hidden="true">
                      <div className="project-review-header-cell">Project name ({projectIndex.length})</div>
                      <div className="project-review-header-cell">Next milestone</div>
                      <div className="project-review-header-cell">Challenges</div>
                    </div>
                    {reviewRows.map(({ project, lead, reviewSnapshot, nextMilestone, nextMilestoneLabel, nextMilestoneNote }) => {
                      const challengeItems = getChallengeColumn(reviewSnapshot?.challengeSnapshot);

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
                            <span className={`project-review-column-value ${nextMilestone ? '' : 'subtle'}`}>
                              {nextMilestone ? nextMilestone.title : nextMilestoneLabel}
                            </span>
                            {nextMilestone ? (
                              <span className="project-review-column-note">{nextMilestoneNote}</span>
                            ) : null}
                          </div>
                          <div className="project-review-column project-review-column-challenges">
                            {challengeItems.length > 0 ? (
                              <div className="project-review-challenge-list">
                                {challengeItems.map((challenge, index) => {
                                  const tone = challenge.severity === 'blocking'
                                    ? 'danger'
                                    : challenge.severity === 'slowing' || challenge.severity === 'minor'
                                      ? 'warning'
                                      : 'neutral';

                                  return (
                                    <div
                                      key={challenge.id || `${project.id}-challenge-${index}`}
                                      className="project-review-challenge-item"
                                    >
                                      <span className={`project-review-challenge-label ${tone}`}>
                                        {getChallengeSeverityLabel(challenge.severity)} challenge
                                      </span>
                                      <span className="project-review-challenge-text">{challenge.description}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="project-review-column-value subtle">No active challenges</span>
                            )}
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
                      className={`timeline-range-btn ${timelineRange === option.value ? 'active' : ''}`}
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
                <div className="timeline-list-empty">
                  <h4>No timeline rows match this search.</h4>
                  <p>Try broadening the search or changing the current timeline range.</p>
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
                          const activityTypeLabel = ACTIVITY_TYPE_LABELS[entry.type];
                          const handleClick = () => {
                            if (entry.projectId) {
                              onProjectClick(entry.projectId);
                            } else if (entry.type === 'concept-note' && onNavigate) {
                              onNavigate('conceptnotes');
                            } else if (entry.type === 'event' && entry.eventId && onNavigate) {
                              onNavigate('events', { event: entry.eventId });
                            } else if (entry.type === 'publication' && onNavigate) {
                              onNavigate('publications');
                            }
                          };
                          const isClickableEntry = Boolean(entry.projectId)
                            || entry.type === 'concept-note'
                            || (entry.type === 'event' && entry.eventId)
                            || entry.type === 'publication';

                          if (isClickableEntry) {
                            return (
                              <button
                                key={`${group.key}-${index}`}
                                type="button"
                                className="activity-item clickable"
                                onClick={handleClick}
                              >
                                <div className="activity-dot" />
                                <div className="activity-content">
                                  <div className="activity-title">
                                    {activityTypeLabel && (
                                      <span className="activity-type-label" data-type={entry.type}>
                                        {activityTypeLabel}
                                      </span>
                                    )}
                                    {entry.title}
                                  </div>
                                  <div className="activity-meta">
                                    {(entry.context || entry.project) && <>{entry.context || entry.project} &bull; </>}
                                    {formatDate(entry.date)}
                                    {entry.author && <> &bull; {entry.author}</>}
                                  </div>
                                </div>
                              </button>
                            );
                          }

                          return (
                            <div
                              key={`${group.key}-${index}`}
                              className="activity-item"
                            >
                              <div className="activity-dot" />
                              <div className="activity-content">
                                <div className="activity-title">
                                  {activityTypeLabel && (
                                    <span className="activity-type-label" data-type={entry.type}>
                                      {activityTypeLabel}
                                    </span>
                                  )}
                                  {entry.title}
                                </div>
                                <div className="activity-meta">
                                  {(entry.context || entry.project) && <>{entry.context || entry.project} &bull; </>}
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
