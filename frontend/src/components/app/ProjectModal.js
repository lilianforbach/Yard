import React from 'react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../lib/constants';
import { getProjectContributorIds, getProjectLeadId } from '../../lib/projectTeam';
import { getFeedbackAudienceBadges, getLinkedPerson, getProjectSurfaceAccess } from '../../lib/roleAccess';
import SlidePanel from './SlidePanel';
import LatexContent from './LatexContent';

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
  const visibleUpdates = (project.updates || [])
    .slice(0, 2);
  const visibleFeedback = (project.feedback || [])
    .filter((entry) => access.canViewFeedbackEntry(entry))
    .slice(0, 2);
  const projMilestones = milestones
    .filter((m) => m.project === project.id)
    .sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''))
    .slice(0, 5);

  const header = (
    <>
      <button data-testid="view-full-project" className="view-full-link" onClick={() => onViewFull(project.id)}>
        View full project page &rarr;
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
      {visibleUpdates.length > 0 && (
        <div className="modal-section">
          <h4>Recent Progress</h4>
          {visibleUpdates.map((u, i) => (
            <div key={i} className="update-item-compact">
              <div className="update-title-compact">{u.title}</div>
              <div className="update-meta-compact">{formatDate(u.lastModified || u.date)}</div>
            </div>
          ))}
        </div>
      )}
      {visibleFeedback.length > 0 && (
        <div className="modal-section">
          <h4>Feedback</h4>
          {visibleFeedback.map((fb, i) => (
            <div key={i} className="update-item-compact">
              <div className="update-title-compact">{fb.title || fb.content?.substring(0, 80)}</div>
              <div className="update-meta-compact">
                {formatDate(fb.lastModified || fb.date)} &bull; {fb.author}
                {getFeedbackAudienceBadges(fb).map((badge) => ` • ${badge}`)}
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
