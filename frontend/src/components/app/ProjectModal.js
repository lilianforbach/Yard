import React from 'react';
import { Maximize2 } from 'lucide-react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../lib/constants';
import { getProjectContributorIds, getProjectLeadId } from '../../lib/projectTeam';
import { getFeedbackAudienceBadges, getLinkedPerson, getProjectSurfaceAccess } from '../../lib/roleAccess';
import SlidePanel from './SlidePanel';
import LatexContent from './LatexContent';

function getFeedbackDisplayTitle(entry) {
  const title = (entry?.title || '').trim();
  if (title) return title;
  const excerpt = (entry?.content || '').replace(/\s+/g, ' ').trim();
  if (!excerpt) return 'Feedback';
  return excerpt.length > 88 ? `${excerpt.slice(0, 85).trim()}...` : excerpt;
}

export default function ProjectModal({ projectId, onClose, onViewFull, onPersonClick }) {
  const { getProject, getPerson, getInstitution, milestones } = useData();
  const { permissions } = useAuth();
  const project = getProject(projectId);
  if (!project) return null;

  const inst = getInstitution(project.institution);
  const linkedPerson = getLinkedPerson(permissions, getPerson);
  const access = getProjectSurfaceAccess({ permissions, linkedPerson, project });
  const lead = getPerson(getProjectLeadId(project));
  const contributors = getProjectContributorIds(project).map((id) => getPerson(id)).filter(Boolean);
  const visibleFeedback = (project.feedback || [])
    .map((entry) => ({ ...entry, entryType: 'feedback' }))
    .filter((entry) => access.canViewFeedbackEntry(entry));
  const visibleProgress = [
    ...(project.updates || []).map((entry) => ({ ...entry, entryType: 'updates' })),
    ...visibleFeedback,
  ]
    .sort((a, b) => ((b.lastModified || b.date || '').localeCompare(a.lastModified || a.date || '')))
    .slice(0, 2);
  const projMilestones = milestones
    .filter((m) => m.project === project.id)
    .sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''))
    .slice(0, 5);

  const header = (
    <>
      <button data-testid="view-full-project" className="view-full-link project-list-open-page" onClick={() => onViewFull(project.id)}>
        Open full page <Maximize2 size={13} aria-hidden="true" />
      </button>
      <h2>{project.title}</h2>
      <div className="modal-meta">
        {lead && (
          <div className="modal-meta-row">
            <span className="modal-meta-label">Lead</span>
            <button type="button" className="modal-meta-link clickable" onClick={() => onPersonClick(lead.id)}>
              {lead.name}
            </button>
          </div>
        )}
        {contributors.length > 0 && (
          <div className="modal-meta-row">
            <span className="modal-meta-label">Contributors</span>
            <div className="modal-meta-list">
              {contributors.map((c) => (
                <button type="button" key={c.id} className="modal-meta-link clickable" onClick={() => onPersonClick(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );

  const panelContent = (
    <>
      {visibleProgress.length > 0 && (
        <div className="modal-section">
          <h4>Recent Progress</h4>
          {visibleProgress.map((entry, i) => (
            <div key={i} className="update-item-compact">
              <div className="update-title-compact">
                {entry.entryType === 'feedback' ? getFeedbackDisplayTitle(entry) : entry.title}
                <span className={`entry-type-badge ${entry.entryType}`}>
                  {entry.entryType === 'feedback' ? 'Feedback' : 'Update'}
                </span>
              </div>
              <div className="update-meta-compact">
                {formatDate(entry.lastModified || entry.date)}
                {entry.entryType === 'feedback' && entry.author ? ` • ${entry.author}` : ''}
                {entry.entryType === 'feedback' ? getFeedbackAudienceBadges(entry).map((badge) => ` • ${badge}`) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {projMilestones.length > 0 && (
        <div className="modal-section">
          <h4>Milestones</h4>
          {projMilestones.map(m => (
            <div key={m.id} className="milestone-item-compact">
              <span className={`milestone-dot ${m.computedStatus === 'completed' ? 'is-complete' : 'is-open'}`} />
              <span>{m.title}</span>
              <span className="milestone-date-compact">{formatDate(m.dueDate)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="modal-section">
        <h4>Abstract</h4>
        <LatexContent text={project.abstract} className="modal-abstract-content" emptyText="No abstract added yet." />
      </div>
    </>
  );

  return (
    <SlidePanel
      onClose={onClose}
      testId="project-modal"
      headerStyle={{ borderBottomColor: inst?.color || '#E5E7EB' }}
      headerContent={header}
      showOverlay={false}
      panelClassName="project-slide-panel"
      ariaLabel={`${project.title} project summary`}
    >
      {panelContent}
    </SlidePanel>
  );
}
