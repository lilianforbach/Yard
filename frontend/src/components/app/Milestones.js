import React, { useMemo, useState } from 'react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { Search, X, Plus } from 'lucide-react';
import { formatDate } from '../../lib/constants';
import { getProjectLeadId } from '../../lib/projectTeam';
import { canAccessProjectReview, getProjectReviewSnapshot } from '../../lib/projectReview';
import { canCreateGlobalMilestones, getLinkedPerson } from '../../lib/roleAccess';
import { matchesSearchQuery } from '../../lib/search';
import { SectionNotice, SectionSkeleton } from './SectionState';

const DEFAULT_REVIEW_STATE = {
  label: '',
  bucket: 'quiet',
  rank: 99,
  tone: 'neutral',
  detail: '',
};

function parseMilestoneDate(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDaysUntil(value) {
  const parsed = parseMilestoneDate(value);
  if (!parsed) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDue = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return Math.round((startOfDue - startOfToday) / (1000 * 60 * 60 * 24));
}

function getTimingBucket(milestone) {
  const daysUntil = getDaysUntil(milestone.dueDate);
  if (milestone.computedStatus === 'completed') return 'completed';
  if (daysUntil == null) return 'unscheduled';
  if (daysUntil < 0) return 'past';
  if (daysUntil <= 30) return 'next-30';
  if (daysUntil <= 90) return 'next-90';
  return 'future';
}

function getTimingLabel(milestone) {
  const daysUntil = getDaysUntil(milestone.dueDate);
  if (milestone.computedStatus === 'completed') {
    return milestone.completedDate ? `Completed on ${formatDate(milestone.completedDate)}` : 'Completed';
  }
  if (daysUntil == null) return 'Estimated date to add';
  if (daysUntil < 0) return `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} past estimated date`;
  if (daysUntil === 0) return 'Estimated for today';
  if (daysUntil === 1) return 'Estimated for tomorrow';
  return `Estimated in ${daysUntil} days`;
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

function getSafeReviewState(reviewSnapshot) {
  return reviewSnapshot?.reviewState || DEFAULT_REVIEW_STATE;
}

function getReviewNote(milestone, reviewSnapshot) {
  const reviewState = getSafeReviewState(reviewSnapshot);
  if (milestone.computedStatus === 'overdue') {
    return 'Past the estimated date and worth reviewing before the next meeting.';
  }
  if (reviewState.bucket === 'needs-review') {
    return reviewState.detail;
  }
  if (milestone.computedStatus === 'approaching') {
    return 'Coming up soon and useful to review ahead of time.';
  }
  if (reviewState.bucket === 'review-soon') {
    return reviewState.detail;
  }
  return 'No review point surfaced.';
}

export default function Milestones({ onProjectClick }) {
  const { milestones, projects, getProject, getPerson, refreshMilestones, refreshResource, loading, resourceStatus } = useData();
  const { permissions } = useAuth();
  const { showToast } = useToast();
  const [view, setView] = useState('milestones');
  const [savedView, setSavedView] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [timingFilter, setTimingFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [leadFilter, setLeadFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ project: '', title: '', dueDate: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const linkedPerson = getLinkedPerson(permissions, getPerson);
  const reviewAccess = canAccessProjectReview(permissions, linkedPerson);
  const canCreateMilestone = canCreateGlobalMilestones(permissions, linkedPerson, projects);

  const projectOptions = useMemo(() => (
    [...projects].sort((a, b) => a.title.localeCompare(b.title))
  ), [projects]);

  const leadOptions = useMemo(() => {
    const seen = new Map();
    projects.forEach((project) => {
      const leadId = getProjectLeadId(project);
      const lead = getPerson(leadId);
      if (lead && !seen.has(lead.id)) {
        seen.set(lead.id, lead);
      }
    });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [getPerson, projects]);

  const roadmapRows = useMemo(() => (
    milestones.map((milestone) => {
      const project = getProject(milestone.project);
      const lead = getPerson(getProjectLeadId(project));
      const reviewSnapshot = project ? getProjectReviewSnapshot(project, milestones) : null;
      const timingBucket = getTimingBucket(milestone);

        return {
          milestone,
          project,
          lead,
          reviewSnapshot,
          timingBucket,
          timingLabel: getTimingLabel(milestone),
          reviewNote: getReviewNote(milestone, reviewSnapshot),
        };
      })
  ), [getPerson, getProject, milestones]);

  const filteredRows = useMemo(() => {
    const query = search;

    return roadmapRows
      .filter((row) => {
        if (savedView === 'upcoming' && !['next-30', 'next-90'].includes(row.timingBucket)) return false;
        if (savedView === 'overdue' && row.milestone.computedStatus !== 'overdue') return false;
        if (savedView === 'for-review') {
          const reviewState = getSafeReviewState(row.reviewSnapshot);
          const needsReview = row.milestone.computedStatus === 'overdue'
            || row.milestone.computedStatus === 'approaching'
            || reviewState.bucket === 'needs-review'
            || reviewState.bucket === 'review-soon';
          if (!needsReview) return false;
        }

        if (statusFilter !== 'all' && (row.milestone.computedStatus || 'on-track') !== statusFilter) return false;
        if (timingFilter !== 'all' && row.timingBucket !== timingFilter) return false;
        if (projectFilter !== 'all' && row.project?.id !== projectFilter) return false;
        if (leadFilter !== 'all' && row.lead?.id !== leadFilter) return false;

        return matchesSearchQuery(
          query,
          row.milestone.title,
          row.project?.title,
          row.lead?.name,
          row.milestone.type,
          row.reviewNote,
          row.timingLabel
        );
      })
      .sort((a, b) => {
        const statusRank = { overdue: 0, approaching: 1, 'on-track': 2, completed: 3 };
        const rankA = statusRank[a.milestone.computedStatus || 'on-track'] ?? 2;
        const rankB = statusRank[b.milestone.computedStatus || 'on-track'] ?? 2;
        if (rankA !== rankB) return rankA - rankB;

        const dateA = a.milestone.dueDate || '9999-12-31';
        const dateB = b.milestone.dueDate || '9999-12-31';
        const dateDiff = dateA.localeCompare(dateB);
        if (dateDiff !== 0) return dateDiff;

        return a.milestone.title.localeCompare(b.milestone.title);
      });
  }, [leadFilter, projectFilter, roadmapRows, savedView, search, statusFilter, timingFilter]);

  const timelineRows = useMemo(() => {
    const groupedByProject = new Map();

    filteredRows.forEach((row) => {
      if (!row.project) return;
      if (!groupedByProject.has(row.project.id)) {
        groupedByProject.set(row.project.id, {
          projectId: row.project.id,
          projectTitle: row.project.title,
          milestones: [],
          reviewSnapshot: row.reviewSnapshot,
        });
      }
      groupedByProject.get(row.project.id).milestones.push(row.milestone);
    });

    return [...groupedByProject.values()]
      .map((group) => {
        const dates = group.milestones
          .map((milestone) => parseMilestoneDate(milestone.dueDate))
          .filter(Boolean);
        const minDate = dates.length ? new Date(Math.min(...dates)) : new Date();
        const maxDate = dates.length ? new Date(Math.max(...dates)) : new Date();
        return { ...group, minDate, maxDate };
      })
      .sort((a, b) => a.minDate - b.minDate);
  }, [filteredRows]);

  const globalMin = useMemo(() => {
    const all = timelineRows.flatMap((row) => [row.minDate, row.maxDate]);
    return all.length ? new Date(Math.min(...all)) : new Date();
  }, [timelineRows]);

  const globalMax = useMemo(() => {
    const all = timelineRows.flatMap((row) => [row.minDate, row.maxDate]);
    return all.length ? new Date(Math.max(...all)) : new Date();
  }, [timelineRows]);

  const months = useMemo(() => {
    const result = [];
    const start = new Date(globalMin.getFullYear(), globalMin.getMonth(), 1);
    const end = new Date(globalMax.getFullYear(), globalMax.getMonth() + 1, 0);
    const current = new Date(start);

    while (current <= end) {
      result.push(new Date(current));
      current.setMonth(current.getMonth() + 1);
    }

    return result;
  }, [globalMax, globalMin]);

  const today = new Date();

  if (loading && milestones.length === 0) {
    return <SectionSkeleton cards={5} />;
  }

  if (milestones.length === 0 && resourceStatus.milestones.status === 'error') {
    return (
      <SectionNotice
        title="Milestones are unavailable"
        message={resourceStatus.milestones.error || 'The roadmap data could not be loaded.'}
        onRetry={() => refreshResource('milestones')}
      />
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.project || !form.title.trim() || !form.dueDate) {
      setFormError('Please fill in all required fields.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/milestones', form);
      await refreshMilestones();
      setShowForm(false);
      setForm({ project: '', title: '', dueDate: '' });
      showToast('Milestone created successfully');
    } catch (err) {
      console.error('Failed to create milestone:', err);
      setFormError('Failed to create milestone. Please try again.');
      showToast('Failed to create milestone', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const totalMs = (globalMax - globalMin) || 1;
  const todayPct = today >= globalMin && today <= globalMax ? ((today - globalMin) / totalMs) * 100 : null;

  return (
    <section data-testid="milestones-section" className="section active">
      <div className="section-controls">
        <div className="view-toggle">
          <button data-testid="milestones-list-view" className={`filter-btn ${view === 'milestones' ? 'active' : ''}`} onClick={() => setView('milestones')}>Milestones</button>
          <button data-testid="milestones-timeline-view" className={`filter-btn ${view === 'timeline' ? 'active' : ''}`} onClick={() => setView('timeline')}>Timeline</button>
        </div>
        <div className="section-actions">
          <div className="search-box">
            <Search size={16} />
            <input data-testid="milestones-search" type="text" placeholder="Search milestones, projects, or leads..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {canCreateMilestone && (
            <button type="button" className="action-btn" onClick={() => setShowForm(true)}>
              <Plus size={16} /> Add Milestone
            </button>
          )}
        </div>
      </div>

      <div className="roadmap-saved-views">
        <button type="button" className={`filter-btn ${savedView === 'all' ? 'active' : ''}`} onClick={() => setSavedView('all')}>All</button>
        <button type="button" className={`filter-btn ${savedView === 'upcoming' ? 'active' : ''}`} onClick={() => setSavedView('upcoming')}>Upcoming</button>
        <button type="button" className={`filter-btn ${savedView === 'overdue' ? 'active' : ''}`} onClick={() => setSavedView('overdue')}>Delayed</button>
        {reviewAccess && (
          <button type="button" className={`filter-btn ${savedView === 'for-review' ? 'active' : ''}`} onClick={() => setSavedView('for-review')}>Needs attention</button>
        )}
      </div>

      <div className="roadmap-filter-bar">
        <label className="roadmap-filter">
          <span>Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="overdue">Delayed</option>
            <option value="approaching">Approaching</option>
            <option value="on-track">Scheduled</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label className="roadmap-filter">
          <span>Timing</span>
          <select value={timingFilter} onChange={(e) => setTimingFilter(e.target.value)}>
            <option value="all">Any timing</option>
            <option value="next-30">Next 30 days</option>
            <option value="next-90">Next 90 days</option>
            <option value="future">Later ahead</option>
            <option value="past">Past due</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label className="roadmap-filter">
          <span>Project</span>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="all">All projects</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>{project.title}</option>
            ))}
          </select>
        </label>
        <label className="roadmap-filter">
          <span>Lead</span>
          <select value={leadFilter} onChange={(e) => setLeadFilter(e.target.value)}>
            <option value="all">All leads</option>
            {leadOptions.map((lead) => (
              <option key={lead.id} value={lead.id}>{lead.name}</option>
            ))}
          </select>
        </label>
      </div>

      {view === 'milestones' ? (
        <div className="roadmap-list-shell">
          <div className="roadmap-list-header">
            <div className="roadmap-list-header-cell roadmap-main-col">Milestone</div>
            <div className="roadmap-list-header-cell">Next date</div>
            <div className="roadmap-list-header-cell">Lead</div>
            <div className="roadmap-list-header-cell">{reviewAccess ? 'Review note' : 'Current signal'}</div>
          </div>
          {filteredRows.length > 0 ? (
            filteredRows.map((row) => (
              <button
                key={row.milestone.id}
                type="button"
                className="roadmap-list-row"
                onClick={() => row.project && onProjectClick?.(row.project.id)}
              >
                <div className="roadmap-list-main">
                  <div className="roadmap-list-title-row">
                    <span className={`roadmap-status-dot ${row.milestone.computedStatus === 'completed' ? 'is-complete' : 'is-open'}`} />
                    <span className="roadmap-list-title">{row.milestone.title}</span>
                  </div>
                  <div className="roadmap-list-meta">
                    <span>{row.project?.title || row.milestone.project}</span>
                    <span>•</span>
                    <span>{row.milestone.type}</span>
                  </div>
                </div>
                <div className="roadmap-list-col">
                  <div className="roadmap-list-date">{formatDate(row.milestone.dueDate)}</div>
                  <div className={`roadmap-list-note is-${row.milestone.computedStatus || 'on-track'}`}>{getStatusLabel(row.milestone.computedStatus)}</div>
                  <div className="roadmap-list-note">{row.timingLabel}</div>
                </div>
                <div className="roadmap-list-col">
                  <div className="roadmap-list-value">{row.lead?.name || 'Lead needed'}</div>
                </div>
                <div className="roadmap-list-col">
                  <div className="roadmap-list-value">
                    {reviewAccess ? (getSafeReviewState(row.reviewSnapshot).label || 'No active review signal') : getStatusLabel(row.milestone.computedStatus)}
                  </div>
                  <div className="roadmap-list-note">
                    {reviewAccess ? row.reviewNote : row.timingLabel}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="roadmap-list-empty">
              <h4>No milestones match these filters</h4>
              <p>Try broadening the saved view or clearing one of the current filters.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="timeline-container">
          {timelineRows.length > 0 ? (
            <>
              <div className="roadmap-container">
                <div className="roadmap-header">
                  {months.map((month, index) => {
                    const isCurrentMonth = month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();
                    return (
                      <div key={index} className={`roadmap-month${isCurrentMonth ? ' current' : ''}`}>
                        {month.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).toUpperCase()}
                      </div>
                    );
                  })}
                </div>
                {timelineRows.map((row) => {
                  const startPct = ((row.minDate - globalMin) / totalMs) * 100;
                  const endPct = ((row.maxDate - globalMin) / totalMs) * 100;
                  const widthPct = Math.max(2, endPct - startPct);
                  const statusPriority = { overdue: 0, approaching: 1, 'on-track': 2, completed: 3 };
                  const worstStatus = row.milestones.reduce((worst, milestone) => {
                    const current = milestone.computedStatus || 'on-track';
                    return (statusPriority[current] ?? 2) < (statusPriority[worst] ?? 2) ? current : worst;
                  }, 'completed');

                  return (
                    <div key={row.projectId} className="roadmap-row">
                      <button type="button" className="roadmap-row-label" onClick={() => onProjectClick?.(row.projectId)}>
                        <div className="roadmap-title">{row.projectTitle}</div>
                        <div className="roadmap-row-meta">
                          {reviewAccess
                            ? (getSafeReviewState(row.reviewSnapshot).label || `${row.milestones.length} milestone${row.milestones.length === 1 ? '' : 's'}`)
                            : `${row.milestones.length} milestone${row.milestones.length === 1 ? '' : 's'}`}
                        </div>
                      </button>
                      <div className="roadmap-bar-area">
                        {months.map((month, index) => {
                          const gridPct = ((month - globalMin) / totalMs) * 100;
                          return <div key={index} className="roadmap-gridline" style={{ left: `${gridPct}%` }} />;
                        })}
                        {todayPct !== null && <div className="roadmap-today" style={{ left: `${todayPct}%` }} />}
                        <div className={`roadmap-bar status-${worstStatus}`} style={{ left: `${startPct}%`, width: `${widthPct}%` }} />
                        {row.milestones.map((milestone) => {
                          const milestoneDate = parseMilestoneDate(milestone.dueDate);
                          const milestonePct = milestoneDate ? ((milestoneDate - globalMin) / totalMs) * 100 : 0;
                          return (
                            <button
                              key={milestone.id}
                              type="button"
                              className={`roadmap-dot ${milestone.computedStatus || 'on-track'}`}
                              style={{ left: `${milestonePct}%` }}
                              title={`${milestone.title} • ${formatDate(milestone.dueDate)}`}
                              onClick={() => onProjectClick?.(row.projectId)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="roadmap-legend">
                <span className="roadmap-legend-item"><span className="roadmap-legend-dot" /> Not completed</span>
                <span className="roadmap-legend-item"><span className="roadmap-legend-dot completed" /> Completed</span>
                <span className="roadmap-legend-item"><span className="roadmap-legend-today" /> Today</span>
              </div>
            </>
          ) : (
            <div className="roadmap-list-empty">
              <h4>No roadmap rows match these filters</h4>
              <p>Try broadening the saved view or switching back to the full milestone list.</p>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content form-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add milestone">
            <button type="button" className="modal-close" onClick={() => setShowForm(false)} aria-label="Close milestone form"><X size={20} /></button>
            <h2>Add Milestone</h2>
            {formError && <div className="form-error-box">{formError}</div>}
            <form onSubmit={handleSubmit} className="cg-form">
              <div className="form-field">
                <label>Project</label>
                <select data-testid="milestone-project-select" value={form.project} onChange={e => setForm({ ...form, project: e.target.value })} required disabled={submitting}>
                  <option value="">Select project...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label>Title</label>
                <input data-testid="milestone-title-input" type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="Milestone title" disabled={submitting} />
              </div>
              <div className="form-field">
                <label>Estimated Date</label>
                <input data-testid="milestone-date-input" type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} required disabled={submitting} />
              </div>
              <button data-testid="milestone-submit-btn" type="submit" className="action-btn submit-btn" disabled={submitting}>
                {submitting ? (
                  <>
                    <span className="spinner"></span> Creating...
                  </>
                ) : (
                  'Create Milestone'
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
