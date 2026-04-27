import React, { useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { formatDate } from '../../lib/constants';
import {
  getConceptNoteContributorLabel,
  getConceptNoteFrontstageState,
  getConceptNoteProgressSummary,
  getConceptNoteSortDate,
  isConceptNoteProgressed,
} from '../../lib/conceptNotes';
import { getLinkedPerson } from '../../lib/roleAccess';
import { canAccessProjectReview } from '../../lib/projectReview';
import SlidePanel from './SlidePanel';

export default function ConceptNotePanel({ noteId, onClose, onNoteClick }) {
  const { permissions } = useAuth();
  const { conceptNotes, getPerson, getProject } = useData();
  const linkedPerson = getLinkedPerson(permissions, getPerson);
  const reviewAccess = canAccessProjectReview(permissions, linkedPerson);
  const note = conceptNotes.find((candidate) => candidate.id === noteId);

  const contributorLabel = note ? getConceptNoteContributorLabel(note, getPerson) : '';
  const state = note ? getConceptNoteFrontstageState(note) : 'all';
  const freshnessDate = note ? getConceptNoteSortDate(note) : '';
  const sortedProgressSignals = useMemo(
    () => (note?.progressSignals || [])
      .map((signal, index) => ({ signal, index }))
      .sort((a, b) => (b.signal.date || '').localeCompare(a.signal.date || '')),
    [note]
  );

  if (!note) return null;

  const header = (
    <>
      <div className="concept-panel-title-row">
        <h2>{note.title}</h2>
        {state !== 'all' && (
          <span className={`cn-status-badge ${state}`}>
            {state === 'progressed' ? 'Progressed' : 'Active'}
          </span>
        )}
      </div>
      <div className="panel-meta">
        {contributorLabel && <span className="inst-badge">{contributorLabel}</span>}
        {freshnessDate && <span className="inst-badge">Updated {formatDate(freshnessDate)}</span>}
        {reviewAccess && !isConceptNoteProgressed(note) && note.activeUntil && (
          <span className="inst-badge">Active until {formatDate(note.activeUntil)}</span>
        )}
      </div>
    </>
  );

  return (
    <SlidePanel
      onClose={onClose}
      testId="concept-note-panel"
      headerContent={header}
      showOverlay={false}
      ariaLabel={`${note.title} concept note`}
    >
      {sortedProgressSignals.length > 0 && (
        <div className="cn-section">
          <h4>Progress</h4>
          <div className="cn-progress-list">
            {sortedProgressSignals.map(({ signal, index }) => {
              const summary = getConceptNoteProgressSummary(signal, getProject);
              return (
                <div key={`${signal.kind}-${signal.date || index}-${index}`} className="cn-progress-item">
                  <div className="cn-progress-copy">
                    <div className="cn-progress-label-row">
                      <span className="cn-progress-label">{summary.label}</span>
                      {signal.date && <span className="cn-progress-date">{formatDate(signal.date)}</span>}
                    </div>
                    {summary.detail && <p>{summary.detail}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {note.rationale && <div className="cn-section"><h4>Rationale</h4><p>{note.rationale}</p></div>}
      {note.relevance && <div className="cn-section"><h4>Programme Relevance</h4><p>{note.relevance}</p></div>}
      {note.preliminaryInsights && <div className="cn-section"><h4>Preliminary Insights</h4><p>{note.preliminaryInsights}</p></div>}
      {note.nextSteps && <div className="cn-section"><h4>Next Steps</h4><p>{note.nextSteps}</p></div>}

      {(note.relatedProjects || []).length > 0 && (
        <div className="cn-section">
          <h4>Related Projects</h4>
          <div className="cn-related">
            {note.relatedProjects.map((projectId) => {
              const project = getProject(projectId);
              return <span key={projectId} className="cn-related-tag">{project?.title || projectId}</span>;
            })}
          </div>
        </div>
      )}

      {(note.relatedConceptNoteIds || []).length > 0 && (
        <div className="cn-section">
          <h4>Related Concept Notes</h4>
          <div className="cn-related">
            {note.relatedConceptNoteIds.map((relatedId) => {
              const relatedNote = conceptNotes.find((candidate) => candidate.id === relatedId);
              if (!relatedNote) return null;
              return (
                <button
                  key={relatedId}
                  type="button"
                  className="cn-related-note-button"
                  onClick={() => onNoteClick?.(relatedId)}
                >
                  {relatedNote.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </SlidePanel>
  );
}
