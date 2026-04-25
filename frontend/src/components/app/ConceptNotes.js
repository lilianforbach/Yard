import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, PencilLine, Plus, Search, X } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/constants';
import {
  getConceptNoteContributorLabel,
  getConceptNoteDaysUntilActiveEnds,
  getConceptNoteFrontstageState,
  getConceptNoteProgressSummary,
  getConceptNoteSortDate,
  isConceptNoteActive,
  isConceptNoteProgressed,
} from '../../lib/conceptNotes';
import { canAccessMaintenance, getConceptNoteTrustCue } from '../../lib/maintenance';
import { getLinkedPerson } from '../../lib/roleAccess';
import { canAccessProjectReview } from '../../lib/projectReview';
import { matchesSearchQuery } from '../../lib/search';
import SlidePanel from './SlidePanel';
import { SectionNotice, SectionSkeleton } from './SectionState';
import TagSelect from './TagSelect';

const PROGRESS_KIND_OPTIONS = [
  { value: 'linked-project', label: 'Linked to related project' },
  { value: 'connection-made', label: 'Connection made' },
  { value: 'informed-discussion', label: 'Informed programme discussion' },
  { value: 'taken-forward', label: 'Taken forward' },
];

const TAKEN_FORWARD_OPTIONS = [
  { value: 'existing-project', label: 'In project work' },
  { value: 'new-project', label: 'As a new project' },
  { value: 'work-package', label: 'In a work package' },
];

function buildInitialForm(linkedPersonId = '') {
  return {
    title: '',
    contributors: linkedPersonId ? [linkedPersonId] : [],
    rationale: '',
    relevance: '',
    preliminaryInsights: '',
    nextSteps: '',
  };
}

function buildFormFromNote(note) {
  return {
    title: note?.title || '',
    contributors: note?.contributors || [],
    rationale: note?.rationale || '',
    relevance: note?.relevance || '',
    preliminaryInsights: note?.preliminaryInsights || '',
    nextSteps: note?.nextSteps || '',
  };
}

function buildProgressDraft(note) {
  return {
    kind: 'linked-project',
    projectId: note?.relatedProjects?.[0] || '',
    targetType: 'existing-project',
    note: '',
  };
}

function getActiveWindowSummary(note) {
  const daysUntilActiveEnds = getConceptNoteDaysUntilActiveEnds(note);

  if (daysUntilActiveEnds == null) {
    return 'No active window set';
  }
  if (daysUntilActiveEnds < 0) {
    const daysAgo = Math.abs(daysUntilActiveEnds);
    return daysAgo === 1 ? 'Active window ended 1 day ago' : `Active window ended ${daysAgo} days ago`;
  }
  if (daysUntilActiveEnds === 0) {
    return 'Active window ends today';
  }
  if (daysUntilActiveEnds === 1) {
    return 'Active window ends in 1 day';
  }
  return `Active window ends in ${daysUntilActiveEnds} days`;
}

export default function ConceptNotes({ onPanelOpen }) {
  const { permissions } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    conceptNotes,
    getPerson,
    getProject,
    projects,
    people,
    refreshConceptNotes,
    refreshResource,
    loading,
    resourceStatus,
  } = useData();
  const { showToast } = useToast();

  const linkedPerson = getLinkedPerson(permissions, getPerson);
  const maintenanceAccess = canAccessMaintenance(permissions);
  const reviewAccess = canAccessProjectReview(permissions, linkedPerson);
  const requestedNoteId = searchParams.get('note');

  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState('create');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [form, setForm] = useState(() => buildInitialForm(linkedPerson?.id));
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stewardshipAction, setStewardshipAction] = useState('');
  const [progressDraft, setProgressDraft] = useState(() => buildProgressDraft(null));
  const [stewardshipError, setStewardshipError] = useState('');
  const [relatedDraft, setRelatedDraft] = useState([]);
  const [relatedProjectDraft, setRelatedProjectDraft] = useState([]);
  const canCreateNote = Boolean(linkedPerson?.id);

  const peopleOptions = useMemo(
    () => people.map((person) => ({ value: person.id, label: person.name })),
    [people]
  );

  const projectOptions = useMemo(
    () => projects.map((project) => ({ value: project.id, label: project.title })),
    [projects]
  );

  const selectedNote = conceptNotes.find((note) => note.id === selectedNoteId) || null;
  const editingNote = conceptNotes.find((note) => note.id === editingNoteId) || null;
  const selectedState = selectedNote ? getConceptNoteFrontstageState(selectedNote) : 'all';
  const selectedContributorLabel = selectedNote ? getConceptNoteContributorLabel(selectedNote, getPerson) : '';
  const selectedFreshnessDate = selectedNote ? getConceptNoteSortDate(selectedNote) : '';
  const selectedTrustCue = selectedNote ? getConceptNoteTrustCue(selectedNote) : null;
  const selectedContributorNames = useMemo(
    () => (selectedNote?.contributors || [])
      .map((contributorId) => getPerson(contributorId)?.name || contributorId)
      .filter(Boolean),
    [getPerson, selectedNote]
  );
  const canEditSelectedNote = Boolean(
    selectedNote && (
      permissions?.isAdmin
      || (linkedPerson?.id && (
        selectedNote.createdBy === linkedPerson.id
        || (selectedNote.contributors || []).includes(linkedPerson.id)
      ))
    )
  );
  const canManageSelectedContributors = Boolean(
    selectedNote && (
      permissions?.isAdmin
      || (linkedPerson?.id && selectedNote.createdBy === linkedPerson.id)
    )
  );

  const relatedConceptNoteOptions = useMemo(
    () => conceptNotes
      .filter((note) => note.id !== selectedNote?.id)
      .map((note) => ({ value: note.id, label: note.title })),
    [conceptNotes, selectedNote?.id]
  );

  const filtered = useMemo(() => {
    const matchingNotes = conceptNotes.filter((note) => {
      if (filter === 'active' && !isConceptNoteActive(note)) return false;
      if (filter === 'progressed' && !isConceptNoteProgressed(note)) return false;

      const contributorLabel = getConceptNoteContributorLabel(note, getPerson);
      const relatedProjectTitles = (note.relatedProjects || [])
        .map((projectId) => getProject(projectId)?.title)
        .filter(Boolean);
      const relatedNoteTitles = (note.relatedConceptNoteIds || [])
        .map((relatedId) => conceptNotes.find((candidate) => candidate.id === relatedId)?.title)
        .filter(Boolean);
      const progressLabels = (note.progressSignals || [])
        .map((signal) => {
          const summary = getConceptNoteProgressSummary(signal, getProject);
          return [summary.label, summary.detail, signal.note].filter(Boolean).join(' ');
        });

      return matchesSearchQuery(
        search,
        note.title,
        contributorLabel,
        note.rationale,
        note.relevance,
        note.preliminaryInsights,
        note.nextSteps,
        ...relatedProjectTitles,
        ...relatedNoteTitles,
        ...progressLabels
      );
    });

    return [...matchingNotes].sort((a, b) => {
      if (filter === 'all') {
        const rank = { active: 0, progressed: 1, all: 2 };
        const stateDiff = rank[getConceptNoteFrontstageState(a)] - rank[getConceptNoteFrontstageState(b)];
        if (stateDiff !== 0) return stateDiff;
      }
      return getConceptNoteSortDate(b).localeCompare(getConceptNoteSortDate(a));
    });
  }, [conceptNotes, filter, getPerson, getProject, search]);

  const sortedProgressSignals = useMemo(
    () => (selectedNote?.progressSignals || [])
      .map((signal, index) => ({ signal, index }))
      .sort((a, b) => (b.signal.date || '').localeCompare(a.signal.date || '')),
    [selectedNote]
  );

  useEffect(() => {
    if (requestedNoteId) {
      setSelectedNoteId(requestedNoteId);
    }
  }, [requestedNoteId]);

  useEffect(() => {
    if (selectedNote) {
      setProgressDraft(buildProgressDraft(selectedNote));
      setRelatedDraft(selectedNote.relatedConceptNoteIds || []);
      setRelatedProjectDraft(selectedNote.relatedProjects || []);
      setStewardshipError('');
    }
  }, [selectedNote]);

  useEffect(() => {
    if (selectedNoteId && !filtered.find((note) => note.id === selectedNoteId)) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('note');
      setSelectedNoteId(null);
      setSearchParams(nextParams, { replace: true });
    }
  }, [filtered, searchParams, selectedNoteId, setSearchParams]);

  if (loading && conceptNotes.length === 0) {
    return <SectionSkeleton cards={4} />;
  }

  if (conceptNotes.length === 0 && resourceStatus.conceptNotes.status === 'error') {
    return (
      <SectionNotice
        title="Concept notes are unavailable"
        message={resourceStatus.conceptNotes.error || 'The concept note feed could not be loaded.'}
        onRetry={() => refreshResource('conceptNotes')}
      />
    );
  }

  const openForm = () => {
    if (!canCreateNote) {
      showToast('Only signed-in programme members with a profile can create concept notes.', 'error');
      return;
    }
    setFormMode('create');
    setEditingNoteId(null);
    setForm(buildInitialForm(linkedPerson?.id));
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (note) => {
    setFormMode('edit');
    setEditingNoteId(note.id);
    setForm(buildFormFromNote(note));
    setFormError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormMode('create');
    setEditingNoteId(null);
    setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (formMode === 'create' && !linkedPerson?.id) {
      setFormError('Concept notes can only be created by signed-in programme members with a profile.');
      return;
    }

    if (!form.title.trim() || !form.rationale.trim()) {
      setFormError(
        formMode === 'create'
          ? 'Please provide a title, at least one contributor, and a rationale.'
          : 'Please provide a title and a rationale.'
      );
      return;
    }

    if (formMode === 'create' && form.contributors.length === 0) {
      setFormError('Please provide at least one contributor.');
      return;
    }

    if (formMode === 'create' && !form.contributors.includes(linkedPerson.id)) {
      setFormError('Include yourself as a contributor when creating a concept note.');
      return;
    }

    if (formMode === 'edit' && canManageSelectedContributors && form.contributors.length === 0) {
      setFormError('Please keep at least one contributor on the concept note.');
      return;
    }

    if (
      formMode === 'edit'
      && canManageSelectedContributors
      && !permissions?.isAdmin
      && linkedPerson?.id
      && !form.contributors.includes(linkedPerson.id)
    ) {
      setFormError('Keep yourself in the contributor list, or ask an admin to make the change.');
      return;
    }

    setSubmitting(true);
    try {
      if (formMode === 'create') {
        await api.post('/conceptnotes', form);
      } else if (editingNote) {
        const payload = {
          title: form.title.trim(),
          rationale: form.rationale.trim(),
          relevance: form.relevance.trim(),
          preliminaryInsights: form.preliminaryInsights.trim(),
          nextSteps: form.nextSteps.trim(),
        };
        if (canManageSelectedContributors) {
          payload.contributors = form.contributors;
        }
        await api.put(`/conceptnotes/${editingNote.id}`, payload);
      }
      await refreshConceptNotes();
      closeForm();
      showToast(formMode === 'create' ? 'Concept note created successfully' : 'Concept note updated');
    } catch (err) {
      console.error(`Failed to ${formMode === 'create' ? 'create' : 'update'} concept note:`, err);
      const detail = err.response?.data?.detail;
      setFormError(
        typeof detail === 'string'
          ? detail
          : `Failed to ${formMode === 'create' ? 'create' : 'update'} concept note. Please try again.`
      );
      showToast(`Failed to ${formMode === 'create' ? 'create' : 'update'} concept note`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExtendActive = async () => {
    if (!selectedNote) return;
    setStewardshipAction('extend');
    setStewardshipError('');

    try {
      await api.post(`/conceptnotes/${selectedNote.id}/extend-active`);
      await refreshConceptNotes();
      showToast('Concept note kept in active view for one more month');
    } catch (err) {
      console.error('Failed to extend concept note visibility:', err);
      setStewardshipError('Could not extend the active window just now.');
      showToast('Failed to extend concept note visibility', 'error');
    } finally {
      setStewardshipAction('');
    }
  };

  const handleUndoExtension = async () => {
    if (!selectedNote) return;
    setStewardshipAction('undo');
    setStewardshipError('');

    try {
      await api.post(`/conceptnotes/${selectedNote.id}/undo-active-extension`);
      await refreshConceptNotes();
      showToast('Last active-window extension was undone');
    } catch (err) {
      console.error('Failed to undo concept note visibility change:', err);
      setStewardshipError('Could not undo the last extension just now.');
      showToast('Failed to undo concept note visibility change', 'error');
    } finally {
      setStewardshipAction('');
    }
  };

  const handleAddProgressSignal = async () => {
    if (!selectedNote) return;

    if (progressDraft.kind === 'linked-project' && !progressDraft.projectId) {
      setStewardshipError('Choose a related project for this progress trace.');
      return;
    }

    if (progressDraft.kind === 'taken-forward' && progressDraft.targetType === 'existing-project' && !progressDraft.projectId) {
      setStewardshipError('Choose the project this note has been taken forward into.');
      return;
    }

    setStewardshipAction('progress');
    setStewardshipError('');

    const nextSignal = {
      kind: progressDraft.kind,
      note: progressDraft.note.trim(),
    };

    if (progressDraft.kind === 'linked-project') {
      nextSignal.projectId = progressDraft.projectId;
    }

    if (progressDraft.kind === 'taken-forward') {
      nextSignal.targetType = progressDraft.targetType;
      if (progressDraft.targetType === 'existing-project') {
        nextSignal.projectId = progressDraft.projectId;
      }
    }

    try {
      await api.put(`/conceptnotes/${selectedNote.id}`, {
        progressSignals: [...(selectedNote.progressSignals || []), nextSignal],
      });
      await refreshConceptNotes();
      setProgressDraft(buildProgressDraft(selectedNote));
      showToast('Progress trace added');
    } catch (err) {
      console.error('Failed to add progress trace:', err);
      setStewardshipError('Could not save the progress trace just now.');
      showToast('Failed to save progress trace', 'error');
    } finally {
      setStewardshipAction('');
    }
  };

  const handleRemoveProgressSignal = async (indexToRemove) => {
    if (!selectedNote) return;
    setStewardshipAction(`remove-progress-${indexToRemove}`);
    setStewardshipError('');

    try {
      await api.put(`/conceptnotes/${selectedNote.id}`, {
        progressSignals: (selectedNote.progressSignals || []).filter((_, index) => index !== indexToRemove),
      });
      await refreshConceptNotes();
      showToast('Progress trace removed');
    } catch (err) {
      console.error('Failed to remove progress trace:', err);
      setStewardshipError('Could not remove that progress trace just now.');
      showToast('Failed to remove progress trace', 'error');
    } finally {
      setStewardshipAction('');
    }
  };

  const handleSaveRelatedNotes = async () => {
    if (!selectedNote) return;
    setStewardshipAction('related');
    setStewardshipError('');

    try {
      await api.put(`/conceptnotes/${selectedNote.id}`, {
        relatedConceptNoteIds: relatedDraft,
      });
      await refreshConceptNotes();
      showToast('Related concept notes updated');
    } catch (err) {
      console.error('Failed to save related concept notes:', err);
      setStewardshipError('Could not save related concept notes just now.');
      showToast('Failed to save related concept notes', 'error');
    } finally {
      setStewardshipAction('');
    }
  };

  const handleSaveRelatedProjects = async () => {
    if (!selectedNote) return;
    setStewardshipAction('related-projects');
    setStewardshipError('');

    try {
      await api.put(`/conceptnotes/${selectedNote.id}`, {
        relatedProjects: relatedProjectDraft,
      });
      await refreshConceptNotes();
      showToast('Related projects updated');
    } catch (err) {
      console.error('Failed to save related projects:', err);
      setStewardshipError('Could not save related projects just now.');
      showToast('Failed to save related projects', 'error');
    } finally {
      setStewardshipAction('');
    }
  };

  const closeSelectedNote = () => {
    setSelectedNoteId(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('note');
    setSearchParams(nextParams, { replace: true });
  };

  const panelHeader = selectedNote ? (
    <>
      <div className="concept-panel-title-row">
        <h2>{selectedNote.title}</h2>
        {selectedState !== 'all' && (
          <span className={`cn-status-badge ${selectedState}`}>
            {selectedState === 'progressed' ? 'Progressed' : 'Active'}
          </span>
        )}
      </div>
      <div className="panel-meta">
        {selectedContributorLabel && <span className="inst-badge">{selectedContributorLabel}</span>}
        {selectedFreshnessDate && <span className="inst-badge">Updated {formatDate(selectedFreshnessDate)}</span>}
        {reviewAccess && !isConceptNoteProgressed(selectedNote) && selectedNote.activeUntil && (
          <span className="inst-badge">Active until {formatDate(selectedNote.activeUntil)}</span>
        )}
      </div>
      {canEditSelectedNote && (
        <div className="panel-header-actions">
          <button
            type="button"
            className="action-btn small"
            onClick={() => openEditForm(selectedNote)}
          >
            <PencilLine size={14} /> Edit Concept Note
          </button>
        </div>
      )}
    </>
  ) : null;

  const detailContent = selectedNote ? (
    <>
      {permissions?.isAdmin && (
        <div className="cn-section cn-section-emphasis">
          <div className="cn-stewardship-topline">
            <div>
              <div className="admin-record-cue-label">Programme stewardship</div>
              <div className="admin-record-cue-headline">{getActiveWindowSummary(selectedNote)}</div>
              <div className="admin-record-cue-note">
                Keep this note in active view if it still needs attention, or record a progress trace when it has created value.
              </div>
            </div>
            <div className="cn-stewardship-actions">
              <button
                type="button"
                className="cn-stage-action"
                onClick={handleExtendActive}
                disabled={stewardshipAction !== ''}
              >
                {stewardshipAction === 'extend' ? 'Adding month...' : 'Add 1 month'}
              </button>
              {selectedNote.lastActiveExtension && (
                <button
                  type="button"
                  className="cn-stage-action secondary"
                  onClick={handleUndoExtension}
                  disabled={stewardshipAction !== ''}
                >
                  {stewardshipAction === 'undo' ? 'Undoing...' : 'Undo'}
                </button>
              )}
            </div>
          </div>

          {maintenanceAccess && selectedTrustCue && (
            <div className={`admin-record-cue ${selectedTrustCue.tone}`}>
              <div className="admin-record-cue-label">Admin cue</div>
              <div className="admin-record-cue-headline">{selectedTrustCue.headline}</div>
              <div className="admin-record-cue-note">{selectedTrustCue.note}</div>
            </div>
          )}

          <div className="cn-stewardship-grid">
            <div className="cn-stewardship-block">
              <h4>Add Progress Trace</h4>
              <div className="cn-stewardship-form">
                <label>
                  <span>Progress trace</span>
                  <select
                    value={progressDraft.kind}
                    onChange={(e) => {
                      const nextKind = e.target.value;
                      setProgressDraft((current) => ({
                        ...current,
                        kind: nextKind,
                        targetType: nextKind === 'taken-forward' ? current.targetType : 'existing-project',
                      }));
                    }}
                    disabled={stewardshipAction !== ''}
                  >
                    {PROGRESS_KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                {progressDraft.kind === 'taken-forward' && (
                  <label>
                    <span>Destination</span>
                    <select
                      value={progressDraft.targetType}
                      onChange={(e) => setProgressDraft((current) => ({ ...current, targetType: e.target.value }))}
                      disabled={stewardshipAction !== ''}
                    >
                      {TAKEN_FORWARD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {(progressDraft.kind === 'linked-project'
                  || (progressDraft.kind === 'taken-forward' && progressDraft.targetType === 'existing-project')) && (
                  <label>
                    <span>Project</span>
                    <select
                      value={progressDraft.projectId}
                      onChange={(e) => setProgressDraft((current) => ({ ...current, projectId: e.target.value }))}
                      disabled={stewardshipAction !== ''}
                    >
                      <option value="">Choose a project...</option>
                      {projectOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                <label>
                  <span>Context <em>optional</em></span>
                  <input
                    type="text"
                    value={progressDraft.note}
                    onChange={(e) => setProgressDraft((current) => ({ ...current, note: e.target.value }))}
                    placeholder="Short stewardship note"
                    disabled={stewardshipAction !== ''}
                  />
                </label>

                <button
                  type="button"
                  className="action-btn secondary"
                  onClick={handleAddProgressSignal}
                  disabled={stewardshipAction !== ''}
                >
                  {stewardshipAction === 'progress' ? 'Saving trace...' : 'Add progress trace'}
                </button>
              </div>
            </div>

            <div className="cn-stewardship-block">
              <h4>Related Projects</h4>
              <div className="cn-stewardship-form">
                <label>
                  <span>Structured links</span>
                  <TagSelect
                    options={projectOptions}
                    value={relatedProjectDraft}
                    onChange={setRelatedProjectDraft}
                    placeholder="Search projects..."
                    disabled={stewardshipAction !== ''}
                  />
                </label>
                <button
                  type="button"
                  className="action-btn secondary"
                  onClick={handleSaveRelatedProjects}
                  disabled={stewardshipAction !== ''}
                >
                  {stewardshipAction === 'related-projects' ? 'Saving links...' : 'Save related projects'}
                </button>
              </div>
            </div>

            <div className="cn-stewardship-block">
              <h4>Related Concept Notes</h4>
              <div className="cn-stewardship-form">
                <label>
                  <span>Overlap or adjacency</span>
                  <TagSelect
                    options={relatedConceptNoteOptions}
                    value={relatedDraft}
                    onChange={setRelatedDraft}
                    placeholder="Search concept notes..."
                    disabled={stewardshipAction !== ''}
                  />
                </label>
                <button
                  type="button"
                  className="action-btn secondary"
                  onClick={handleSaveRelatedNotes}
                  disabled={stewardshipAction !== ''}
                >
                  {stewardshipAction === 'related' ? 'Saving links...' : 'Save related notes'}
                </button>
              </div>
            </div>
          </div>

          {stewardshipError && <div className="form-error-box cn-stewardship-error">{stewardshipError}</div>}
        </div>
      )}

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
                  {permissions?.isAdmin && (
                    <button
                      type="button"
                      className="cn-progress-remove"
                      onClick={() => handleRemoveProgressSignal(index)}
                      disabled={stewardshipAction !== ''}
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedNote.rationale && <div className="cn-section"><h4>Rationale</h4><p>{selectedNote.rationale}</p></div>}
      {selectedNote.relevance && <div className="cn-section"><h4>Programme Relevance</h4><p>{selectedNote.relevance}</p></div>}
      {selectedNote.preliminaryInsights && <div className="cn-section"><h4>Preliminary Insights</h4><p>{selectedNote.preliminaryInsights}</p></div>}
      {selectedNote.nextSteps && <div className="cn-section"><h4>Next Steps</h4><p>{selectedNote.nextSteps}</p></div>}

      {(selectedNote.relatedProjects || []).length > 0 && (
        <div className="cn-section">
          <h4>Related Projects</h4>
          <div className="cn-related">
            {selectedNote.relatedProjects.map((projectId) => {
              const project = getProject(projectId);
              return <span key={projectId} className="cn-related-tag">{project?.title || projectId}</span>;
            })}
          </div>
        </div>
      )}

      {(selectedNote.relatedConceptNoteIds || []).length > 0 && (
        <div className="cn-section">
          <h4>Related Concept Notes</h4>
          <div className="cn-related">
            {selectedNote.relatedConceptNoteIds.map((relatedId) => {
              const relatedNote = conceptNotes.find((note) => note.id === relatedId);
              if (!relatedNote) return null;
              return (
                <button
                  key={relatedId}
                  type="button"
                  className="cn-related-note-button"
                  onClick={() => {
                    onPanelOpen?.();
                    setSelectedNoteId(relatedId);
                    const nextParams = new URLSearchParams(searchParams);
                    nextParams.set('note', relatedId);
                    setSearchParams(nextParams, { replace: true });
                  }}
                >
                  {relatedNote.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  ) : null;

  return (
    <section data-testid="conceptnotes-section" className="section active">
      <div className="section-controls">
        <div className="view-toggle">
          <button
            data-testid="cn-active-filter"
            className={`filter-btn ${filter === 'active' ? 'active' : ''}`}
            onClick={() => setFilter('active')}
          >
            Active
          </button>
          <button
            data-testid="cn-progressed-filter"
            className={`filter-btn ${filter === 'progressed' ? 'active' : ''}`}
            onClick={() => setFilter('progressed')}
          >
            Progressed
          </button>
          <button
            data-testid="cn-all-filter"
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
        </div>
        <div className="search-box">
          <Search size={16} />
          <input
            data-testid="concept-notes-search"
            type="text"
            placeholder="Search concept notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canCreateNote && (
          <button data-testid="new-concept-note-btn" className="action-btn" onClick={openForm}>
            <Plus size={16} /> Add Concept Note
          </button>
        )}
      </div>

      <div className="conceptnotes-shell">
        <div className="conceptnotes-list-pane">
          <div className="conceptnotes-list-scroll">
            <div className="cn-list">
              {filtered.map((note) => {
                const contributorLabel = getConceptNoteContributorLabel(note, getPerson);
                const frontstageState = getConceptNoteFrontstageState(note);
                const progressSignals = note.progressSignals || [];
                const latestProgress = progressSignals[progressSignals.length - 1];
                const latestProgressSummary = latestProgress ? getConceptNoteProgressSummary(latestProgress, getProject) : null;

                return (
                  <button
                    key={note.id}
                    type="button"
                    data-testid={`concept-note-${note.id}`}
                    className={`cn-list-row ${selectedNoteId === note.id ? 'active' : ''}`}
                    onClick={() => {
                      onPanelOpen?.();
                      setSelectedNoteId(note.id);
                      const nextParams = new URLSearchParams(searchParams);
                      nextParams.set('note', note.id);
                      setSearchParams(nextParams, { replace: true });
                    }}
                  >
                    <div className="cn-list-main">
                      <div className="cn-list-title-row">
                        <div className="cn-list-title">{note.title}</div>
                        <ChevronRight size={16} className="cn-list-chevron" aria-hidden="true" />
                      </div>
                      <div className="cn-list-meta">
                        {contributorLabel && <span>{contributorLabel}</span>}
                        {frontstageState === 'progressed' && latestProgressSummary && (
                          <span className="cn-list-signal">{latestProgressSummary.label}</span>
                        )}
                        {reviewAccess && frontstageState === 'active' && note.activeUntil && (
                          <span className="cn-list-signal">Active until {formatDate(note.activeUntil)}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}

              {filtered.length === 0 && (
                <p className="empty-state">
                  {filter === 'active'
                    ? 'No active concept notes right now.'
                    : filter === 'progressed'
                      ? 'No concept notes with visible progress yet.'
                      : 'No concept notes found in this view yet.'}
                </p>
              )}
            </div>
          </div>
        </div>

        {selectedNote && (
          <SlidePanel
            onClose={closeSelectedNote}
            testId="concept-note-panel"
            headerContent={panelHeader}
            showOverlay={false}
            ariaLabel={`${selectedNote.title} concept note`}
          >
            {detailContent}
          </SlidePanel>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div
            className="modal-content form-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={formMode === 'create' ? 'New concept note' : 'Edit concept note'}
          >
            <button type="button" className="modal-close" onClick={closeForm} aria-label="Close concept note form"><X size={20} /></button>
            <h2>{formMode === 'create' ? 'Share Concept Note' : 'Edit Concept Note'}</h2>
            <p className="form-helper-copy">
              {formMode === 'create'
                ? 'Share an early idea worth keeping in view across the programme.'
                : 'Refine the core content of this concept note while leaving stewardship actions separate.'}
            </p>
            {formError && <div className="form-error-box">{formError}</div>}
            <form onSubmit={handleSubmit} className="cg-form">
              <div className="form-field">
                <label>Title</label>
                <input
                  data-testid="cn-title-input"
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  placeholder="Concept note title"
                  disabled={submitting}
                />
              </div>
              <div className="form-field">
                <label>Contributors</label>
                {formMode === 'edit' && !canManageSelectedContributors ? (
                  <>
                    <p>{selectedContributorNames.join(', ') || 'No contributors listed.'}</p>
                    <p className="form-field-hint">Only the note creator or admin can change contributors.</p>
                  </>
                ) : (
                  <TagSelect
                    options={peopleOptions}
                    value={form.contributors}
                    onChange={(value) => setForm({ ...form, contributors: value })}
                    placeholder="Search people..."
                    disabled={submitting}
                  />
                )}
              </div>
              <div className="form-field">
                <label>Rationale</label>
                <p className="form-field-hint">State the opportunity, why it matters, and what kind of next step or response would help.</p>
                <textarea
                  data-testid="cn-rationale-input"
                  value={form.rationale}
                  onChange={(e) => setForm({ ...form, rationale: e.target.value })}
                  placeholder="Why this idea matters..."
                  rows={3}
                  required
                  disabled={submitting}
                />
              </div>
              <div className="form-field">
                <label>Relevance <span className="form-optional">optional</span></label>
                <textarea
                  value={form.relevance}
                  onChange={(e) => setForm({ ...form, relevance: e.target.value })}
                  placeholder="How it relates to the programme..."
                  rows={2}
                  disabled={submitting}
                />
              </div>
              <div className="form-field">
                <label>Preliminary Insights <span className="form-optional">optional</span></label>
                <textarea
                  value={form.preliminaryInsights}
                  onChange={(e) => setForm({ ...form, preliminaryInsights: e.target.value })}
                  placeholder="Early findings or hypotheses..."
                  rows={2}
                  disabled={submitting}
                />
              </div>
              <div className="form-field">
                <label>Next Steps <span className="form-optional">optional</span></label>
                <textarea
                  value={form.nextSteps}
                  onChange={(e) => setForm({ ...form, nextSteps: e.target.value })}
                  placeholder="What kind of next step or response would help..."
                  rows={2}
                  disabled={submitting}
                />
              </div>
              <button data-testid="cn-submit-btn" type="submit" className="action-btn submit-btn" disabled={submitting}>
                {submitting ? (
                  <>
                    <span className="spinner"></span> {formMode === 'create' ? 'Creating...' : 'Saving...'}
                  </>
                ) : (
                  formMode === 'create' ? 'Share Concept Note' : 'Save Concept Note'
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
