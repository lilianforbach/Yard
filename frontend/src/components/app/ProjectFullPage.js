import React, { useState, useCallback } from 'react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import { formatDate, getRoleLabel } from '../../lib/constants';
import { buildProjectTeamPayload, getProjectContributorIds, getProjectLeadId } from '../../lib/projectTeam';
import {
  getFeedbackAudienceBadges,
  getFeedbackAudienceState,
  getLinkedPerson,
  getProjectSurfaceAccess,
  normalizeFeedbackBaseAudience,
} from '../../lib/roleAccess';
import SearchableSelect from './SearchableSelect';
import TagSelect from './TagSelect';
import EditableField from './EditableField';
import WritingModal from './WritingModal';
import LatexContent from './LatexContent';
import LatexTextarea from './LatexTextarea';

function getSlidesEmbedUrl(rawUrl) {
  if (!rawUrl) return '';

  try {
    const url = new URL(rawUrl);
    if (url.hostname.includes('docs.google.com') && url.pathname.includes('/presentation/')) {
      if (url.pathname.includes('/pubembed') || url.pathname.includes('/embed')) {
        return url.toString();
      }
      const segments = url.pathname.split('/');
      const modeIndex = segments.findIndex((segment) => ['edit', 'view', 'preview', 'present'].includes(segment));
      if (modeIndex !== -1) {
        segments[modeIndex] = 'embed';
      } else {
        return url.toString();
      }
      url.pathname = segments.join('/');
      url.search = 'start=false&loop=false&delayms=3000';
      url.hash = '';
      return url.toString();
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function normalizeSlidesInput(rawValue) {
  const cleaned = (rawValue || '').trim();
  if (!cleaned) return '';
  const match = cleaned.match(/src=["']([^"']+)["']/i);
  return match?.[1]?.trim() || cleaned;
}

function normalizeSvgInput(rawValue) {
  const cleaned = (rawValue || '').trim();
  if (!cleaned) return '';
  const match = cleaned.match(/src=["']([^"']+)["']/i);
  return match?.[1]?.trim() || cleaned;
}

function getUploadedVisualReference(rawValue) {
  const cleaned = normalizeSvgInput(rawValue);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned, window.location.origin);
    for (const prefix of ['/api/uploads/visual/', '/api/uploads/svg/']) {
      if (!url.pathname.startsWith(prefix)) continue;
      const filename = decodeURIComponent(url.pathname.slice(prefix.length)).trim().replace(/^\/+|\/+$/g, '');
      if (!filename) return null;
      const kind = prefix.includes('/visual/') ? 'visual' : 'svg';
      return { kind, filename };
    }
  } catch {
    return null;
  }
  return null;
}

const MAX_VISUALS = 5;
const MAX_VISUAL_UPLOAD_BYTES = 5 * 1024 * 1024;
const VISUAL_UPLOAD_ACCEPT = '.svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg';
const CHALLENGE_SEVERITY_OPTIONS = [
  { value: 'slowing', label: 'Slowing' },
  { value: 'blocking', label: 'Blocking' },
];
const FEEDBACK_BASE_AUDIENCE_OPTIONS = [
  { value: 'lead', label: 'Lead only' },
  { value: 'team', label: 'Project team' },
];
const CHALLENGE_DESCRIPTION_PLACEHOLDER = [
  '• Challenges can bring useful feedback, contact, or support from across the programme.',
  '• Describe what is currently difficult and, if helpful, what kind of response would move things forward.',
  '• Resolved challenges stay in the project history so others can see how issues were worked through.',
].join('\n');

function normalizeChallengeSeverity(value) {
  if (value === 'minor') return 'slowing';
  return value;
}

function createEmptyProgressForm(author = '') {
  return {
    title: '',
    content: '',
    author,
    feedbackBaseAudience: 'team',
    feedbackIncludeReviewers: false,
    slidesUrl: '',
    svgUrls: [],
  };
}

function hasProgressDraftChanges(mode, form, initialAuthor = '') {
  if (!mode || !form) return false;

  const title = (form.title || '').trim();
  const content = (form.content || '').trim();
  if (title || content) return true;

  if (mode === 'feedback') {
    return (
      (form.author || '').trim() !== (initialAuthor || '').trim()
      || normalizeFeedbackBaseAudience(form.feedbackBaseAudience) !== 'team'
      || Boolean(form.feedbackIncludeReviewers)
    );
  }

  return Boolean(
    (form.slidesUrl || '').trim()
    || (form.svgUrls || []).length > 0
  );
}

function getSvgUrls(record) {
  if (Array.isArray(record?.svgUrls)) {
    return record.svgUrls.filter(Boolean);
  }
  if (record?.svgUrl) {
    return [record.svgUrl];
  }
  return [];
}

function getTodayDateInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMilestoneMetaLabel(milestone) {
  if (milestone.computedStatus === 'completed') {
    return milestone.completedDate ? `Completed on ${formatDate(milestone.completedDate)}` : 'Completed';
  }
  return formatDate(milestone.dueDate);
}

function SvgCarousel({ urls, index, onChange, label }) {
  if (!urls || urls.length === 0) return null;
  const activeIndex = Math.min(index || 0, urls.length - 1);
  const activeUrl = urls[activeIndex];
  const canNavigate = urls.length > 1;

  return (
    <div className="svg-carousel">
      <div className="entry-svg-frame">
        <img src={activeUrl} alt={label} className="entry-svg-image" />
      </div>
      <div className="svg-carousel-footer">
        {canNavigate ? (
          <div className="svg-carousel-controls">
            <button
              type="button"
              className="svg-carousel-btn"
              onClick={() => onChange((activeIndex - 1 + urls.length) % urls.length)}
              aria-label="Show previous visual"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="svg-carousel-count">{activeIndex + 1} / {urls.length}</span>
            <button
              type="button"
              className="svg-carousel-btn"
              onClick={() => onChange((activeIndex + 1) % urls.length)}
              aria-label="Show next visual"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : (
          <span className="svg-carousel-count">1 / 1</span>
        )}
        <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="slides-open-link">
          <ExternalLink size={14} /> Open visual in new tab
        </a>
      </div>
    </div>
  );
}

function SeverityPillGroup({ value, onChange, disabled = false }) {
  return (
    <div className="severity-pill-group" role="radiogroup" aria-label="Severity">
      {CHALLENGE_SEVERITY_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`severity-pill ${option.value}${active ? ' active' : ''}`}
            onClick={() => onChange(option.value)}
            disabled={disabled}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FeedbackAudienceControls({
  baseAudience,
  includeReviewers,
  onBaseChange,
  onToggleReviewers,
  disabled = false,
}) {
  return (
    <div className="feedback-audience-controls">
      <div className="severity-pill-group feedback-audience-group" role="radiogroup" aria-label="Feedback base audience">
        {FEEDBACK_BASE_AUDIENCE_OPTIONS.map((option) => {
          const active = baseAudience === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              className={`severity-pill audience-${option.value}${active ? ' active' : ''}`}
              onClick={() => onBaseChange(option.value)}
              disabled={disabled}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={`feedback-review-toggle${includeReviewers ? ' active' : ''}`}
        onClick={() => onToggleReviewers(!includeReviewers)}
        disabled={disabled}
        aria-pressed={includeReviewers}
      >
        PIs and Reviewers
      </button>
    </div>
  );
}

function SupportingVisualsFields({
  slidesUrl,
  onSlidesChange,
  visualUrls,
  onUploadFiles,
  onRemoveVisual,
  disabled,
  uploading,
  description,
}) {
  const visualCount = visualUrls.length;

  return (
    <div className="form-field supporting-visuals-section">
      <div className="supporting-visuals-heading">
        <label>Supporting visuals <span className="form-optional">Optional</span></label>
      </div>
      <p className="form-field-hint">
        {description}
      </p>

      <div className="supporting-visuals-stack">
        <div className="form-field">
          <div className="supporting-visuals-subheading">
            <label>Upload</label>
            <span className="supporting-visuals-count">{visualCount} / {MAX_VISUALS} files</span>
          </div>
          <input
            type="file"
            accept={VISUAL_UPLOAD_ACCEPT}
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              if (files.length > 0) {
                onUploadFiles(files);
              }
              event.target.value = '';
            }}
            disabled={disabled || uploading || visualCount >= MAX_VISUALS}
          />
        </div>

        {visualUrls.length > 0 && (
          <div className="svg-draft-list">
            {visualUrls.map((url, index) => (
              <div key={url} className="svg-draft-item">
                <span className="svg-draft-label">Visual {index + 1}</span>
                <a href={url} target="_blank" rel="noopener noreferrer" className="slides-open-link">Open</a>
                <button
                  type="button"
                  className="svg-remove-btn"
                  onClick={() => onRemoveVisual(index)}
                  aria-label={`Remove visual ${index + 1}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="form-field">
          <label>Link</label>
          <input
            type="text"
            value={slidesUrl}
            onChange={(event) => onSlidesChange(event.target.value)}
            placeholder="Paste a slides URL or iframe embed code"
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

export default function ProjectFullPage({ projectId, onBack, onPersonClick }) {
  const { getProject, getPerson, getInstitution, milestones, refreshMilestones, people, refreshProjects, replaceProject } = useData();
  const { permissions, user } = useAuth();
  const { showToast } = useToast();
  const project = getProject(projectId);
  const [expandedUpdates, setExpandedUpdates] = useState({});
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ title: '', dueDate: '' });
  const [milestoneFormError, setMilestoneFormError] = useState('');
  const [milestoneSubmitting, setMilestoneSubmitting] = useState(false);
  const [showProgressForm, setShowProgressForm] = useState(null); // 'update' | 'feedback' | null
  const [progressForm, setProgressForm] = useState(() => createEmptyProgressForm());
  const [progressFormError, setProgressFormError] = useState('');
  const [progressSubmitting, setProgressSubmitting] = useState(false);
  const [showProjectSlidesForm, setShowProjectSlidesForm] = useState(false);
  const [projectSlidesDraft, setProjectSlidesDraft] = useState('');
  const [projectSvgDrafts, setProjectSvgDrafts] = useState([]);
  const [projectSlidesSaving, setProjectSlidesSaving] = useState(false);
  const [svgUploading, setSvgUploading] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null); // { type, origIndex, title, content }
  const [showChallengeForm, setShowChallengeForm] = useState(false);
  const [challengeForm, setChallengeForm] = useState({ description: '', severity: 'slowing' });
  const [challengeFormError, setChallengeFormError] = useState('');
  const [challengeSubmitting, setChallengeSubmitting] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState(null); // { origIndex, description, severity }
  const [editingChallengeSubmitting, setEditingChallengeSubmitting] = useState(false);
  const [resolvingChallenge, setResolvingChallenge] = useState(null); // { origIndex, description, resolutionNote }
  const [resolvingChallengeSubmitting, setResolvingChallengeSubmitting] = useState(false);
  const [showResolvedChallenges, setShowResolvedChallenges] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState(null); // { id, title, dueDate }
  const [completingMilestone, setCompletingMilestone] = useState(null); // { id, completedDate }
  const [milestoneActionSubmittingId, setMilestoneActionSubmittingId] = useState('');
  const [editingTeam, setEditingTeam] = useState(false);
  const [teamLeadDraft, setTeamLeadDraft] = useState('');
  const [teamContributorDrafts, setTeamContributorDrafts] = useState([]);
  const [showAbstract, setShowAbstract] = useState(false);
  const [showAllProgress, setShowAllProgress] = useState(false);
  const [showAllFeedback, setShowAllFeedback] = useState(false);
  const [showExpandedMilestones, setShowExpandedMilestones] = useState(false);
  const [projectSvgIndex, setProjectSvgIndex] = useState(0);
  const [entrySvgIndexes, setEntrySvgIndexes] = useState({});
  const [expandedFeedback, setExpandedFeedback] = useState({});

  const saveEntryEdit = useCallback(async (publish = false) => {
    if (!editingEntry) return;
    const { type, origIndex, title, content, slidesUrl, svgUrls, baseAudience, includeReviewers } = editingEntry;
    try {
      const payload = { title, content, publish };
      if (type === 'updates') {
        payload.slidesUrl = normalizeSlidesInput(slidesUrl);
        payload.svgUrls = (svgUrls || []).map(normalizeSvgInput).filter(Boolean);
      } else if (type === 'feedback') {
        payload.audience = normalizeFeedbackBaseAudience(baseAudience);
        payload.includeReviewers = Boolean(includeReviewers);
      }
      await api.put(`/projects/${projectId}/${type}/${origIndex}`, payload);
      await refreshProjects();
      setEditingEntry(null);
      showToast(type === 'feedback' ? 'Feedback saved' : (publish ? 'Entry published' : 'Entry saved quietly'));
    } catch (err) {
      console.error('Failed to update entry:', err);
      showToast(type === 'feedback' ? 'Failed to save feedback' : 'Failed to update entry', 'error');
    }
  }, [editingEntry, projectId, refreshProjects, showToast]);

  const saveMilestoneEdit = useCallback(async () => {
    if (!editingMilestone) return;
    const { id, title, dueDate } = editingMilestone;
    try {
      await api.put(`/milestones/${id}`, { title, dueDate });
      await refreshMilestones();
      setEditingMilestone(null);
      showToast('Milestone saved');
    } catch (err) {
      console.error('Failed to update milestone:', err);
      showToast('Failed to update milestone', 'error');
    }
  }, [editingMilestone, refreshMilestones, showToast]);

  const completeMilestone = useCallback(async () => {
    if (!completingMilestone) return;
    const { id, completedDate } = completingMilestone;
    setMilestoneActionSubmittingId(id);
    try {
      await api.post(`/milestones/${id}/complete`, { completedDate });
      await refreshMilestones();
      setCompletingMilestone(null);
      showToast('Milestone marked complete');
    } catch (err) {
      console.error('Failed to complete milestone:', err);
      showToast('Failed to mark milestone complete', 'error');
    } finally {
      setMilestoneActionSubmittingId('');
    }
  }, [completingMilestone, refreshMilestones, showToast]);

  const reopenMilestone = useCallback(async (milestoneId) => {
    setMilestoneActionSubmittingId(milestoneId);
    try {
      await api.post(`/milestones/${milestoneId}/reopen`, {});
      await refreshMilestones();
      showToast('Milestone reopened');
    } catch (err) {
      console.error('Failed to reopen milestone:', err);
      showToast('Failed to reopen milestone', 'error');
    } finally {
      setMilestoneActionSubmittingId('');
    }
  }, [refreshMilestones, showToast]);

  const saveProjectField = useCallback(async (field, value, publish = false) => {
    const response = await api.put(`/projects/${projectId}`, { [field]: value, publish });
    if (response?.data) {
      replaceProject(response.data);
      return response.data;
    }
    await refreshProjects();
    return null;
  }, [projectId, refreshProjects, replaceProject]);

  const saveTeam = useCallback(async () => {
    if (!teamLeadDraft) {
      showToast('Please choose a project lead', 'error');
      return;
    }
    try {
      const response = await api.put(`/projects/${projectId}`, buildProjectTeamPayload(teamLeadDraft, teamContributorDrafts));
      if (response?.data) {
        replaceProject(response.data);
      } else {
        await refreshProjects();
      }
      setEditingTeam(false);
      showToast('Team updated');
    } catch (err) {
      console.error('Failed to update team:', err);
      showToast('Failed to update team', 'error');
    }
  }, [projectId, refreshProjects, replaceProject, showToast, teamContributorDrafts, teamLeadDraft]);

  const linkedPerson = getLinkedPerson(permissions, getPerson);
  const defaultAuthor = linkedPerson?.name || user?.name || '';
  const formatSeverityLabel = (value) => {
    const normalized = normalizeChallengeSeverity(value);
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '';
  };

  const severityColor = (value) => {
    const normalized = normalizeChallengeSeverity(value);
    return ({ blocking: '#EF4444', slowing: '#F59E0B' }[normalized] || '#6B7280');
  };

  const appendSvgUrl = useCallback((existingUrls, nextUrl) => {
    const normalized = normalizeSvgInput(nextUrl);
    if (!normalized) return existingUrls || [];
    const deduped = [...new Set([...(existingUrls || []), normalized])];
    return deduped.slice(0, MAX_VISUALS);
  }, []);

  const removeSvgUrlAtIndex = useCallback((existingUrls, removeIndex) => {
    return (existingUrls || []).filter((_, index) => index !== removeIndex);
  }, []);

  const resetProgressComposer = useCallback(() => {
    setShowProgressForm(null);
    setProgressForm(createEmptyProgressForm(defaultAuthor));
    setProgressFormError('');
  }, [defaultAuthor]);

  const openProgressComposer = useCallback((mode) => {
    setShowProgressForm(mode);
    setProgressForm(createEmptyProgressForm(defaultAuthor));
    setProgressFormError('');
  }, [defaultAuthor]);

  const uploadSvgFile = useCallback(async (file) => {
    const formData = new FormData();
    formData.append('projectId', projectId);
    formData.append('file', file);
    const response = await api.client.post('/uploads/visual', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }, [projectId]);

  const uploadVisualFiles = useCallback(async (files, currentCount, onAppend) => {
    const fileList = Array.from(files || []);
    if (!fileList.length) return;

    if (currentCount >= MAX_VISUALS) {
      showToast(`A maximum of ${MAX_VISUALS} visuals is allowed`, 'error');
      return;
    }

    const remainingSlots = MAX_VISUALS - currentCount;
    const queuedFiles = fileList.slice(0, remainingSlots);
    if (fileList.length > remainingSlots) {
      showToast(`Only ${remainingSlots} more ${remainingSlots === 1 ? 'file' : 'files'} can be added`, 'error');
    }

    const validFiles = [];
    for (const file of queuedFiles) {
      if (file.size > MAX_VISUAL_UPLOAD_BYTES) {
        showToast(`${file.name} is larger than 5 MB`, 'error');
        continue;
      }
      validFiles.push(file);
    }
    if (!validFiles.length) return;

    setSvgUploading(true);
    let uploadedCount = 0;
    try {
      for (const file of validFiles) {
        const uploaded = await uploadSvgFile(file);
        onAppend(uploaded.url);
        uploadedCount += 1;
      }
      showToast(uploadedCount === 1 ? 'Visual uploaded' : `${uploadedCount} visuals uploaded`);
    } catch (err) {
      console.error('Failed to upload visual:', err);
      showToast('Failed to upload visual', 'error');
    } finally {
      setSvgUploading(false);
    }
  }, [showToast, uploadSvgFile]);

  const handleProgressSvgUpload = useCallback(async (files) => {
    await uploadVisualFiles(files, progressForm.svgUrls?.length || 0, (url) => {
      setProgressForm((current) => ({ ...current, svgUrls: appendSvgUrl(current.svgUrls, url) }));
    });
  }, [appendSvgUrl, progressForm.svgUrls, uploadVisualFiles]);

  const handleEditSvgUpload = useCallback(async (files) => {
    await uploadVisualFiles(files, editingEntry?.svgUrls?.length || 0, (url) => {
      setEditingEntry((current) => current ? { ...current, svgUrls: appendSvgUrl(current.svgUrls, url) } : current);
    });
  }, [appendSvgUrl, editingEntry?.svgUrls, uploadVisualFiles]);

  const handleProjectSvgUpload = useCallback(async (files) => {
    await uploadVisualFiles(files, projectSvgDrafts?.length || 0, (url) => {
      setProjectSvgDrafts((current) => appendSvgUrl(current, url));
    });
  }, [appendSvgUrl, projectSvgDrafts, uploadVisualFiles]);

  const deleteUploadedSvgIfUnused = useCallback(async (url) => {
    const reference = getUploadedVisualReference(url);
    if (!reference) return;
    try {
      await api.delete(`/uploads/${reference.kind}/${encodeURIComponent(reference.filename)}`, {
        params: { projectId },
      });
    } catch (err) {
      console.warn('Failed to delete uploaded visual during draft cleanup:', err);
    }
  }, [projectId]);

  const removeProgressSvg = useCallback((index) => {
    const removedUrl = progressForm.svgUrls?.[index];
    setProgressForm((current) => ({
      ...current,
      svgUrls: removeSvgUrlAtIndex(current.svgUrls, index),
    }));
    if (removedUrl) {
      deleteUploadedSvgIfUnused(removedUrl);
    }
  }, [deleteUploadedSvgIfUnused, progressForm.svgUrls, removeSvgUrlAtIndex]);

  const removeEditingSvg = useCallback((index) => {
    const removedUrl = editingEntry?.svgUrls?.[index];
    setEditingEntry((current) => current ? {
      ...current,
      svgUrls: removeSvgUrlAtIndex(current.svgUrls, index),
    } : current);
    if (removedUrl) {
      deleteUploadedSvgIfUnused(removedUrl);
    }
  }, [deleteUploadedSvgIfUnused, editingEntry?.svgUrls, removeSvgUrlAtIndex]);

  const removeProjectSvg = useCallback((index) => {
    const removedUrl = projectSvgDrafts?.[index];
    setProjectSvgDrafts((current) => removeSvgUrlAtIndex(current, index));
    if (removedUrl) {
      deleteUploadedSvgIfUnused(removedUrl);
    }
  }, [deleteUploadedSvgIfUnused, projectSvgDrafts, removeSvgUrlAtIndex]);

  const dismissProgressComposer = useCallback(async () => {
    if (!showProgressForm || progressSubmitting || svgUploading) return;

    const dirty = hasProgressDraftChanges(showProgressForm, progressForm, defaultAuthor);
    if (dirty && !window.confirm('Discard this draft and lose unsaved changes?')) {
      return;
    }

    const draftSvgUrls = [...(progressForm.svgUrls || [])];
    resetProgressComposer();
    await Promise.allSettled(draftSvgUrls.map((url) => deleteUploadedSvgIfUnused(url)));
  }, [
    defaultAuthor,
    deleteUploadedSvgIfUnused,
    progressForm,
    progressSubmitting,
    resetProgressComposer,
    showProgressForm,
    svgUploading,
  ]);

  const handleMilestoneSubmit = async (e) => {
    e.preventDefault();
    setMilestoneFormError('');
    if (!milestoneForm.title.trim() || !milestoneForm.dueDate) {
      setMilestoneFormError('Please fill in all required fields.');
      return;
    }
    setMilestoneSubmitting(true);
    try {
      await api.post('/milestones', { ...milestoneForm, project: project.id });
      await refreshMilestones();
      setShowMilestoneForm(false);
      setMilestoneForm({ title: '', dueDate: '' });
      showToast('Milestone created successfully');
    } catch (err) {
      console.error('Failed to create milestone:', err);
      setMilestoneFormError('Failed to create milestone. Please try again.');
      showToast('Failed to create milestone', 'error');
    } finally {
      setMilestoneSubmitting(false);
    }
  };

  const handleProgressSubmit = async (publish = true, event = null) => {
    event?.preventDefault?.();
    setProgressFormError('');
    if (!progressForm.title.trim() || !progressForm.content.trim()) {
      setProgressFormError('Please fill in all required fields.');
      return;
    }
    setProgressSubmitting(true);
    const endpoint = showProgressForm === 'feedback' ? 'feedback' : 'updates';
    const entryLabel = showProgressForm === 'feedback' ? 'Feedback' : 'Update';
    try {
      const payload = {
        title: progressForm.title,
        content: progressForm.content,
        publish,
      };
      if (showProgressForm !== 'feedback') {
        if (progressForm.slidesUrl.trim()) {
          payload.slidesUrl = normalizeSlidesInput(progressForm.slidesUrl);
        }
        payload.svgUrls = (progressForm.svgUrls || []).map(normalizeSvgInput).filter(Boolean);
      } else {
        payload.audience = normalizeFeedbackBaseAudience(progressForm.feedbackBaseAudience);
        payload.includeReviewers = Boolean(progressForm.feedbackIncludeReviewers);
      }
      await api.post(`/projects/${project.id}/${endpoint}`, payload);
      await refreshProjects();
      resetProgressComposer();
      showToast(showProgressForm === 'feedback' ? 'Feedback saved' : `${entryLabel} ${publish ? 'published' : 'saved quietly'}`);
    } catch (err) {
      console.error(`Failed to add ${endpoint}:`, err);
      setProgressFormError(showProgressForm === 'feedback'
        ? 'Failed to save feedback. Please try again.'
        : `Failed to ${publish ? 'publish' : 'save'} ${showProgressForm}. Please try again.`);
      showToast(showProgressForm === 'feedback'
        ? 'Failed to save feedback'
        : `Failed to ${publish ? 'publish' : 'save'} ${showProgressForm}`, 'error');
    } finally {
      setProgressSubmitting(false);
    }
  };

  const handleChallengeSubmit = async (publish = true, event = null) => {
    event?.preventDefault?.();
    setChallengeFormError('');
    if (!challengeForm.description.trim()) {
      setChallengeFormError('Please describe the current challenge.');
      return;
    }
    setChallengeSubmitting(true);
    try {
      await api.post(`/projects/${project.id}/challenges`, {
        description: challengeForm.description.trim(),
        severity: normalizeChallengeSeverity(challengeForm.severity),
        raisedBy: defaultAuthor,
        publish,
      });
      await refreshProjects();
      setShowChallengeForm(false);
      setChallengeForm({ description: '', severity: 'slowing' });
      showToast(`Challenge ${publish ? 'published' : 'saved quietly'}`);
    } catch (err) {
      console.error('Failed to add challenge:', err);
      setChallengeFormError(`Failed to ${publish ? 'publish' : 'save'} challenge. Please try again.`);
      showToast(`Failed to ${publish ? 'publish' : 'save'} challenge`, 'error');
    } finally {
      setChallengeSubmitting(false);
    }
  };

  const saveChallengeEdit = useCallback(async (publish = false) => {
    if (!editingChallenge) return;
    setEditingChallengeSubmitting(true);
    try {
      await api.put(`/projects/${projectId}/challenges/${editingChallenge.origIndex}`, {
        description: editingChallenge.description,
        severity: normalizeChallengeSeverity(editingChallenge.severity),
        publish,
      });
      await refreshProjects();
      setEditingChallenge(null);
      showToast(publish ? 'Challenge published' : 'Challenge saved quietly');
    } catch (err) {
      console.error('Failed to update challenge:', err);
      showToast('Failed to update challenge', 'error');
    } finally {
      setEditingChallengeSubmitting(false);
    }
  }, [editingChallenge, projectId, refreshProjects, showToast]);

  const handleResolveChallenge = useCallback(async () => {
    if (!resolvingChallenge) return;
    setResolvingChallengeSubmitting(true);
    try {
      await api.post(`/projects/${projectId}/challenges/${resolvingChallenge.origIndex}/resolve`, {
        resolutionNote: resolvingChallenge.resolutionNote || '',
      });
      await refreshProjects();
      setResolvingChallenge(null);
      setShowResolvedChallenges(true);
      showToast('Challenge resolved');
    } catch (err) {
      console.error('Failed to resolve challenge:', err);
      showToast('Failed to resolve challenge', 'error');
    } finally {
      setResolvingChallengeSubmitting(false);
    }
  }, [projectId, refreshProjects, resolvingChallenge, showToast]);

  const saveProjectSlides = useCallback(async () => {
    setProjectSlidesSaving(true);
    try {
      const response = await api.put(`/projects/${projectId}`, {
        slidesUrl: normalizeSlidesInput(projectSlidesDraft),
        svgUrls: (projectSvgDrafts || []).map(normalizeSvgInput).filter(Boolean),
      });
      if (response?.data) {
        replaceProject(response.data);
      } else {
        await refreshProjects();
      }
      setShowProjectSlidesForm(false);
      showToast('Slides saved');
    } catch (err) {
      console.error('Failed to save slides:', err);
      showToast('Failed to save slides', 'error');
    } finally {
      setProjectSlidesSaving(false);
    }
  }, [projectId, projectSlidesDraft, projectSvgDrafts, refreshProjects, replaceProject, showToast]);

  if (!project) return <div>Project not found</div>;

  const inst = getInstitution(project.institution);
  const lead = getPerson(getProjectLeadId(project));
  const contributors = getProjectContributorIds(project).map((id) => getPerson(id)).filter(Boolean);
  const projectSvgUrls = getSvgUrls(project);
  const access = getProjectSurfaceAccess({ permissions, linkedPerson, project });
  const editable = access.canManageProjectContent;
  const canAddUpdate = access.canAddUpdate;
  const canAddFeedback = access.canAddFeedback;
  const projMilestones = milestones
    .filter(m => m.project === project.id)
    .sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
  const currentChallenges = project.currentChallenges || [];
  const resolvedChallenges = project.resolvedChallenges || [];
  const progressEntries = (project.updates || [])
    .map((u, idx) => ({ ...u, entryType: 'updates', origIndex: idx }))
    .sort((a, b) => ((b.lastModified || b.date || '').localeCompare(a.lastModified || a.date || '')));
  const feedbackEntries = (project.feedback || [])
    .map((f, idx) => ({ ...f, entryType: 'feedback', origIndex: idx }))
    .filter((entry) => access.canViewFeedbackEntry(entry))
    .sort((a, b) => ((b.lastModified || b.date || '').localeCompare(a.lastModified || a.date || '')));
  const showFeedbackSection = canAddFeedback || feedbackEntries.length > 0;
  const abstractPreview = project.abstract
    ? `${project.abstract.substring(0, 220).trim()}${project.abstract.length > 220 ? '...' : ''}`
    : 'No abstract added yet.';
  const visibleProgressEntries = showAllProgress ? progressEntries : progressEntries.slice(0, 2);
  const hiddenProgressCount = Math.max(0, progressEntries.length - visibleProgressEntries.length);
  const visibleFeedbackEntries = showAllFeedback ? feedbackEntries : feedbackEntries.slice(0, 2);
  const hiddenFeedbackCount = Math.max(0, feedbackEntries.length - visibleFeedbackEntries.length);
  const recentlyResolvedSection = resolvedChallenges.length > 0 && (
    <div className="pf-section pf-collapsible-section">
      <button
        type="button"
        className="pf-collapsible-header"
        onClick={() => setShowResolvedChallenges((current) => !current)}
        aria-expanded={showResolvedChallenges}
      >
        <div className="pf-collapsible-copy">
          <h3>Recently Resolved</h3>
          {!showResolvedChallenges && (
            <p className="pf-collapsible-preview">
              {resolvedChallenges.length} resolved challenge{resolvedChallenges.length === 1 ? '' : 's'} kept for project history.
            </p>
          )}
        </div>
        <span className="section-chevron-control" aria-hidden="true">
          {showResolvedChallenges ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>
      {showResolvedChallenges && (
        <div className="pf-collapsible-body resolved-challenges-list">
          {resolvedChallenges.map((c, i) => (
            <div key={c.id || `${c.description}-${i}`} className="challenge-item resolved" style={{ borderLeftColor: severityColor(c.severity) }}>
              <div className="challenge-severity resolved" style={{ color: severityColor(c.severity) }}>{formatSeverityLabel(c.severity)}</div>
              <LatexContent text={c.description} className="challenge-resolved-content" />
              {c.resolutionNote && (
                <div className="challenge-resolution-note">
                  <LatexContent text={c.resolutionNote} className="challenge-resolution-rich-text" />
                </div>
              )}
              <div className="challenge-meta">
                Resolved {formatDate(c.resolvedDate || c.lastModified || c.date)}
                {c.resolvedBy && <> &bull; {c.resolvedBy}</>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  const supportGridSection = (
    <div className="project-support-grid">
      <div className="project-support-column">
        <div className="pf-section">
          <div className="pf-section-header">
            <h3>Current Challenges</h3>
            {access.canManageChallenges && (
              <button className="action-btn small" onClick={() => { setShowChallengeForm(true); setChallengeForm({ description: '', severity: 'slowing' }); }}>
                <Plus size={14} /> Add Challenge
              </button>
            )}
          </div>
          {currentChallenges.length > 0 ? (
            <div className="challenge-catalogue-list">
              {currentChallenges.map((c, i) => (
                <div key={c.id || i} className="challenge-list-row">
                  <div className="challenge-row-grid">
                    <LatexContent text={c.description} className="challenge-list-description" />
                    <div className="challenge-side-rail">
                      <div
                        className="challenge-severity challenge-severity-inline entry-type-badge"
                        style={{ color: severityColor(c.severity) }}
                      >
                        {formatSeverityLabel(c.severity)}
                      </div>
                      <span className="challenge-meta update-meta-date">{formatDate(c.lastModified || c.date)}</span>
                      {access.canManageChallenges && (
                        <div className="entry-edit-actions challenge-actions challenge-actions-stack">
                          <button
                            className="save-mode-btn quiet"
                            type="button"
                            onClick={() => setEditingChallenge({ origIndex: i, description: c.description, severity: normalizeChallengeSeverity(c.severity) })}
                          >
                            Edit
                          </button>
                          <button
                            className="save-mode-btn publish"
                            type="button"
                            onClick={() => setResolvingChallenge({ origIndex: i, description: c.description, resolutionNote: '' })}
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">No current challenges recorded.</p>
          )}
        </div>
        {recentlyResolvedSection}
      </div>

      <div className="project-support-column">
        <div className="pf-section">
          <div className="pf-section-header">
            <h3>Milestones</h3>
            <div className="milestone-section-actions">
              {projMilestones.length > 4 && (
                <button
                  type="button"
                  className="section-chevron-btn"
                  onClick={() => setShowExpandedMilestones((current) => !current)}
                  aria-label={showExpandedMilestones ? 'Collapse milestones' : 'Expand milestones'}
                  aria-expanded={showExpandedMilestones}
                >
                  {showExpandedMilestones ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              )}
              {access.canManageMilestones && (
                <button className="action-btn small" onClick={() => setShowMilestoneForm(true)}>
                  <Plus size={14} /> Add Milestone
                </button>
              )}
            </div>
          </div>
          {projMilestones.length > 0 ? (
            <div className={`milestone-sidebar-list ${showExpandedMilestones ? 'expanded' : ''}`}>
              {projMilestones.map(m => {
                const isMilestoneEditing = editingMilestone && editingMilestone.id === m.id;
                const isCompletingMilestone = completingMilestone && completingMilestone.id === m.id;
                const isMilestoneCompleted = m.computedStatus === 'completed';
                const isMilestoneBusy = milestoneActionSubmittingId === m.id;
                return (
                  <div key={m.id} className="milestone-sidebar-item">
                    <span className={`milestone-dot ${isMilestoneCompleted ? 'is-complete' : 'is-open'}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isMilestoneEditing ? (
                        <>
                          <input className="inline-edit-input small" value={editingMilestone.title} onChange={e => setEditingMilestone({ ...editingMilestone, title: e.target.value })} />
                          <input className="inline-edit-input small" type="date" value={editingMilestone.dueDate} onChange={e => setEditingMilestone({ ...editingMilestone, dueDate: e.target.value })} style={{ marginTop: '0.25rem' }} />
                          <div className="entry-edit-actions" style={{ marginTop: '0.25rem' }}>
                            <button type="button" className="save-mode-btn tertiary" onClick={() => setEditingMilestone(null)}>Cancel</button>
                            <button type="button" className="save-mode-btn publish" onClick={saveMilestoneEdit}>Save Milestone</button>
                          </div>
                        </>
                      ) : isCompletingMilestone ? (
                        <>
                          <div className="milestone-sidebar-title">{m.title}</div>
                          <div className="milestone-sidebar-date">{formatDate(m.dueDate)}</div>
                          <div className="milestone-complete-panel">
                            <label className="milestone-complete-label">Completion date</label>
                            <input
                              className="inline-edit-input small"
                              type="date"
                              value={completingMilestone.completedDate}
                              onChange={(e) => setCompletingMilestone({ ...completingMilestone, completedDate: e.target.value })}
                              disabled={isMilestoneBusy}
                            />
                            <div className="entry-edit-actions" style={{ marginTop: '0.25rem' }}>
                              <button
                                type="button"
                                className="save-mode-btn tertiary"
                                onClick={() => setCompletingMilestone(null)}
                                disabled={isMilestoneBusy}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="save-mode-btn publish"
                                onClick={completeMilestone}
                                disabled={isMilestoneBusy}
                              >
                                {isMilestoneBusy ? 'Saving...' : 'Mark complete'}
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="milestone-sidebar-title">{m.title}</div>
                          <div className="milestone-sidebar-date">
                            {getMilestoneMetaLabel(m)}
                          </div>
                        </>
                      )}
                    </div>
                    {access.canManageMilestones && !isMilestoneEditing && !isCompletingMilestone && (
                      <div className="milestone-row-actions">
                        {isMilestoneCompleted ? (
                          <button
                            type="button"
                            className="entry-edit-btn"
                            onClick={() => reopenMilestone(m.id)}
                            disabled={isMilestoneBusy}
                            title="Reopen"
                          >
                            {isMilestoneBusy ? 'Working...' : 'Reopen'}
                          </button>
	                        ) : (
	                          <button
	                            type="button"
	                            className="entry-edit-btn"
	                            onClick={() => {
	                              setEditingMilestone(null);
	                              setCompletingMilestone({ id: m.id, completedDate: getTodayDateInputValue() });
                            }}
                            disabled={isMilestoneBusy}
                            title="Complete"
                          >
                            Complete
                          </button>
                        )}
                        <button
                          type="button"
                          className="entry-edit-btn"
                          onClick={() => {
                            setCompletingMilestone(null);
                            setEditingMilestone({ id: m.id, title: m.title, dueDate: m.dueDate || '' });
                          }}
                          disabled={isMilestoneBusy}
                          title="Edit"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">No milestones added yet.</p>
          )}
        </div>
      </div>
    </div>
  );
  const renderTeamLinks = (members, emptyLabel = 'None listed yet') => {
    if (!members.length) {
      return <span className="project-team-summary-empty">{emptyLabel}</span>;
    }

    return members.map((member, index) => (
      <React.Fragment key={member.id}>
        <button
          type="button"
          className="project-team-inline-link"
          onClick={() => onPersonClick(member.id)}
        >
          {member.name}
        </button>
        {index < members.length - 1 && <span className="project-team-inline-separator">, </span>}
      </React.Fragment>
    ));
  };

  return (
    <div data-testid="project-full-page" className="project-full-page">
      <button data-testid="back-to-projects" className="back-btn" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Projects
      </button>
      <div className="project-full-header" style={{ borderLeftColor: inst?.color || '#E5E7EB' }}>
        <div className="project-full-header-copy">
          <EditableField
            value={project.title}
            canEdit={editable}
            onSave={(v) => saveProjectField('title', v)}
            placeholder="Project title"
            className="project-title-editable"
            renderValue={(val) => <h1>{val}</h1>}
            showSaveModes={false}
          />
          <div className="project-team-summary">
            <div className="project-team-summary-header">
              {access.canManageTeam && !editingTeam && (
                <button
                  className="action-btn small"
                  type="button"
                  onClick={() => {
                    setTeamLeadDraft(getProjectLeadId(project));
                    setTeamContributorDrafts(getProjectContributorIds(project));
                    setEditingTeam(true);
                  }}
                >
                  Edit Team
                </button>
              )}
            </div>
            {editingTeam ? (
              <div className="team-edit-area project-team-edit-area">
                <div className="form-field">
                  <label>Lead</label>
                  <SearchableSelect
                    options={people.map((person) => ({ value: person.id, label: person.name }))}
                    value={teamLeadDraft}
                    onChange={(value) => {
                      setTeamLeadDraft(value);
                      setTeamContributorDrafts((current) => current.filter((memberId) => memberId !== value));
                    }}
                    placeholder="Select project lead..."
                  />
                </div>
                <div className="form-field">
                  <label>Contributors</label>
                  <TagSelect
                    options={people.filter((person) => person.id !== teamLeadDraft).map((person) => ({ value: person.id, label: person.name }))}
                    value={teamContributorDrafts}
                    onChange={setTeamContributorDrafts}
                    placeholder="Add contributor..."
                  />
                </div>
                <div className="entry-edit-actions" style={{ marginTop: '0.5rem' }}>
                  <button className="save-mode-btn quiet" onClick={saveTeam}>Save</button>
                  <button className="editable-field-btn cancel" onClick={() => setEditingTeam(false)}><X size={14} /></button>
                </div>
              </div>
            ) : (
              <div className="project-team-summary-rows">
                <div className="project-team-summary-row">
                  <span className="project-team-summary-label">Lead</span>
                  <div className="project-team-summary-value">
                    {lead ? renderTeamLinks([lead], 'Not assigned') : <span className="project-team-summary-empty">Not assigned</span>}
                  </div>
                </div>
                <div className="project-team-summary-row">
                  <span className="project-team-summary-label">Contributors</span>
                  <div className="project-team-summary-value">
                    {renderTeamLinks(contributors)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="project-full-layout">
          {supportGridSection}

          <div className="pf-section pf-collapsible-section">
            <button
              type="button"
              className="pf-collapsible-header"
              onClick={() => setShowAbstract((current) => !current)}
              aria-expanded={showAbstract}
            >
              <div className="pf-collapsible-copy">
                <h3>Abstract</h3>
                {!showAbstract && <p className="pf-collapsible-preview">{abstractPreview}</p>}
              </div>
              <span className="section-chevron-control" aria-hidden="true">
                {showAbstract ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </span>
            </button>
            {showAbstract && (
              <div className="pf-collapsible-body">
                <EditableField
                  value={project.abstract}
                  canEdit={editable}
                  multiline
                  enableLatex
                  onSave={(v) => saveProjectField('abstract', v)}
                  placeholder="Add a project abstract"
                  editorTitle="Edit Project Abstract"
                  editorSubtitle="Use this for the durable academic summary of the project rather than short-term updates."
                  showSaveModes={false}
                  renderValue={(value) => (
                    value
                      ? <LatexContent text={value} className="project-abstract-content" />
                      : <span className="editable-field-empty">Add a project abstract</span>
                  )}
                />
              </div>
            )}
          </div>

          <div className="pf-section">
            <div className="pf-section-header">
              <h3>Progress</h3>
              {canAddUpdate && (
                <div className="pf-section-actions">
                  <button className="action-btn small" onClick={() => openProgressComposer('update')}>
                    <Plus size={14} /> Add Update
                  </button>
                </div>
              )}
            </div>
            <div className="progress-catalogue-list">
              {visibleProgressEntries
                .map((entry, i) => {
                  return (
                    <div key={i} className={`update-item ${entry.entryType === 'feedback' ? 'feedback-item' : ''} ${expandedUpdates[i] ? 'expanded' : ''}`}>
                      <div className="update-header" onClick={() => setExpandedUpdates(prev => ({ ...prev, [i]: !prev[i] }))}>
                        <div className="update-row-grid">
                          <div className="update-title">{entry.title}</div>
                          <span className={`entry-type-badge ${entry.entryType}`}>
                            {entry.entryType === 'feedback' ? 'Feedback' : 'Update'}
                          </span>
                          <div className="update-date-cell">
                            <span className="update-meta-date">{formatDate(entry.date)}</span>
                            <div className="update-header-right">
                              {access.canEditProjectEntry(entry) && (
                                <button
                                  className="entry-edit-btn"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setEditingEntry({
                                      type: entry.entryType,
                                    origIndex: entry.origIndex,
                                    title: entry.title,
                                    content: entry.content,
                                    author: entry.author,
                                    ...getFeedbackAudienceState(entry),
                                    slidesUrl: entry.slidesUrl || '',
                                    svgUrls: getSvgUrls(entry),
                                  });
                                  }}
                                  title="Edit"
                                >
                                  Edit
                                </button>
                              )}
                              <span className="update-toggle-chevron" aria-hidden="true">
                                {expandedUpdates[i] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </span>
                            </div>
                          </div>
                        </div>
                        {entry.entryType === 'feedback' && entry.author && (
                          <div className="update-author-line">
                            {entry.author}
                          </div>
                        )}
                      </div>
                      {expandedUpdates[i] && (
                        <div className="update-content">
                          <LatexContent text={entry.content} className="update-content-body" />
                          {entry.entryType === 'updates' && entry.slidesUrl && (
                            <div className="entry-slides-block">
                              <div className="entry-slides-embed">
                                <iframe
                                  src={getSlidesEmbedUrl(entry.slidesUrl)}
                                  title={`${entry.title} slides`}
                                  className="slides-embed-iframe"
                                  allowFullScreen
                                />
                              </div>
                              <div className="entry-slides-footer">
                                <a href={entry.slidesUrl} target="_blank" rel="noopener noreferrer" className="slides-open-link">
                                  <ExternalLink size={14} /> Open slides in new tab
                                </a>
                              </div>
                            </div>
                          )}
                          {entry.entryType === 'updates' && getSvgUrls(entry).length > 0 && (
                            <div className="entry-svg-block">
                              <SvgCarousel
                                urls={getSvgUrls(entry)}
                                index={entrySvgIndexes[i] || 0}
                                onChange={(nextIndex) => setEntrySvgIndexes((current) => ({ ...current, [i]: nextIndex }))}
                                label={`${entry.title} supporting visual`}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
            {progressEntries.length === 0 && (
              <p className="empty-state">No updates recorded yet.</p>
            )}
            {progressEntries.length > 2 && (
              <button
                type="button"
                className="pf-secondary-toggle"
                onClick={() => setShowAllProgress((current) => !current)}
              >
                {showAllProgress ? (
                  <>
                    <span className="inline-chevron-control" aria-hidden="true"><ChevronUp size={15} /></span>
                    Show fewer entries
                  </>
                ) : (
                  <>
                    <span className="inline-chevron-control" aria-hidden="true"><ChevronDown size={15} /></span>
                    Show {hiddenProgressCount} older {hiddenProgressCount === 1 ? 'entry' : 'entries'}
                  </>
                )}
              </button>
            )}
          </div>

          {showFeedbackSection && (
            <div className="pf-section">
              <div className="pf-section-header">
                <div className="pf-section-heading-stack">
                  <h3>Feedback</h3>
                  <p className="pf-section-note">Choose a base audience, then optionally include PIs and Reviewers.</p>
                </div>
                {canAddFeedback && (
                  <div className="pf-section-actions">
                    <button className="action-btn small feedback-btn" onClick={() => openProgressComposer('feedback')}>
                      <Plus size={14} /> Add Feedback
                    </button>
                  </div>
                )}
              </div>
              <div className="progress-catalogue-list">
                {visibleFeedbackEntries.map((entry, i) => (
                  <div key={i} className={`update-item feedback-item ${expandedFeedback[i] ? 'expanded' : ''}`}>
                    <div className="update-header" onClick={() => setExpandedFeedback((prev) => ({ ...prev, [i]: !prev[i] }))}>
                      <div className="update-row-grid">
                        <div className="update-title">{entry.title}</div>
                        <span className="entry-type-badge feedback">Feedback</span>
                        <div className="update-date-cell">
                          <span className="update-meta-date">{formatDate(entry.lastModified || entry.date)}</span>
                          <div className="update-header-right">
                            {access.canEditProjectEntry(entry) && (
                              <button
                                className="entry-edit-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingEntry({
                                    type: entry.entryType,
                                    origIndex: entry.origIndex,
                                    title: entry.title,
                                    content: entry.content,
                                    author: entry.author,
                                    ...getFeedbackAudienceState(entry),
                                    slidesUrl: '',
                                    svgUrls: [],
                                  });
                                }}
                                title="Edit"
                              >
                                Edit
                              </button>
                            )}
                            <span className="update-toggle-chevron" aria-hidden="true">
                              {expandedFeedback[i] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </span>
                          </div>
                        </div>
                      </div>
                      {entry.author && (
                        <div className="update-author-line">
                          {entry.author}
                          <span className="feedback-audience-badges">
                            {getFeedbackAudienceBadges(entry).map((badge) => (
                              <span key={badge} className="feedback-audience-badge">{badge}</span>
                            ))}
                          </span>
                        </div>
                      )}
                    </div>
                    {expandedFeedback[i] && (
                      <div className="update-content">
                        <LatexContent text={entry.content} className="update-content-body" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {feedbackEntries.length === 0 && (
                <p className="empty-state">No feedback visible here yet.</p>
              )}
              {feedbackEntries.length > 2 && (
                <button
                  type="button"
                  className="pf-secondary-toggle"
                  onClick={() => setShowAllFeedback((current) => !current)}
                >
                  {showAllFeedback ? (
                    <>
                      <span className="inline-chevron-control" aria-hidden="true"><ChevronUp size={15} /></span>
                      Show fewer entries
                    </>
                  ) : (
                    <>
                      <span className="inline-chevron-control" aria-hidden="true"><ChevronDown size={15} /></span>
                      Show {hiddenFeedbackCount} older {hiddenFeedbackCount === 1 ? 'entry' : 'entries'}
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          <div className="pf-section">
            <div className="pf-section-header">
              <h3>Presentation Slides</h3>
              {editable && (
                <button
                  className="action-btn small"
                  type="button"
                  onClick={() => {
                    setProjectSlidesDraft(project.slidesUrl || '');
                    setProjectSvgDrafts(projectSvgUrls);
                    setProjectSvgIndex(0);
                    setShowProjectSlidesForm(true);
                  }}
                >
                  <Plus size={14} /> {project.slidesUrl || projectSvgUrls.length > 0 ? 'Edit Slides' : 'Add Slides'}
                </button>
              )}
            </div>
            {project.slidesUrl || projectSvgUrls.length > 0 ? (
              <div className="slides-embed-container">
                {project.slidesUrl && (
                  <>
                    <div className="slides-embed-stage">
                      <iframe
                        src={getSlidesEmbedUrl(project.slidesUrl)}
                        title={`${project.title} — Presentation Slides`}
                        className="slides-embed-iframe"
                        allowFullScreen
                      />
                    </div>
                    <div className="slides-embed-footer">
                      <a href={project.slidesUrl} target="_blank" rel="noopener noreferrer" className="slides-open-link">
                        <ExternalLink size={14} /> Open slides in new tab
                      </a>
                    </div>
                  </>
                )}
                {projectSvgUrls.length > 0 && (
                  <div className="project-svg-block">
                    <SvgCarousel
                      urls={projectSvgUrls}
                      index={projectSvgIndex}
                      onChange={setProjectSvgIndex}
                      label={`${project.title} supporting visual`}
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="empty-state">No slides or uploaded visuals added yet.</p>
            )}
          </div>
      </div>

      {showMilestoneForm && (
        <div className="modal-overlay" onClick={() => setShowMilestoneForm(false)}>
          <div className="modal-content form-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Add milestone to ${project.title}`}>
            <button type="button" className="modal-close" onClick={() => setShowMilestoneForm(false)} aria-label="Close milestone form"><X size={20} /></button>
            <h2>Add Milestone</h2>
            {milestoneFormError && <div className="form-error-box">{milestoneFormError}</div>}
            <form onSubmit={handleMilestoneSubmit} className="cg-form">
              <div className="form-field">
                <label>Title</label>
                <input type="text" value={milestoneForm.title} onChange={e => setMilestoneForm({ ...milestoneForm, title: e.target.value })} required placeholder="Milestone title" disabled={milestoneSubmitting} />
              </div>
              <div className="form-field">
                <label>Estimated Date</label>
                <input type="date" value={milestoneForm.dueDate} onChange={e => setMilestoneForm({ ...milestoneForm, dueDate: e.target.value })} required disabled={milestoneSubmitting} />
              </div>
              <div className="writing-form-actions">
                <button type="submit" className="save-mode-btn publish" disabled={milestoneSubmitting}>
                  {milestoneSubmitting ? 'Adding...' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showProgressForm && (
        <WritingModal
          title={`Add ${showProgressForm === 'feedback' ? 'Feedback' : 'Update'}`}
          subtitle={showProgressForm === 'feedback' ? 'Choose a base audience, then optionally include PIs and Reviewers.' : 'Record a project update that others can refer back to later. Save quietly to keep it on the project page, or Publish to bring it back into shared programme attention.'}
          onClose={dismissProgressComposer}
        >
          {progressFormError && <div className="form-error-box">{progressFormError}</div>}
          <form onSubmit={(event) => handleProgressSubmit(showProgressForm === 'feedback' ? false : true, event)} className="cg-form">
            <div className="form-field">
              <label>Title</label>
              <input type="text" value={progressForm.title} onChange={e => setProgressForm({ ...progressForm, title: e.target.value })} required placeholder={showProgressForm === 'feedback' ? 'e.g. Q1 Review Feedback' : 'e.g. March Progress Summary'} disabled={progressSubmitting} />
            </div>
            {showProgressForm === 'feedback' && (
              <div className="form-field">
                <label>Audience</label>
                <FeedbackAudienceControls
                  baseAudience={normalizeFeedbackBaseAudience(progressForm.feedbackBaseAudience)}
                  includeReviewers={Boolean(progressForm.feedbackIncludeReviewers)}
                  onBaseChange={(value) => setProgressForm({ ...progressForm, feedbackBaseAudience: value })}
                  onToggleReviewers={(value) => setProgressForm({ ...progressForm, feedbackIncludeReviewers: value })}
                  disabled={progressSubmitting}
                />
              </div>
            )}
            <div className="form-field">
              <label>Content</label>
              <LatexTextarea
                value={progressForm.content}
                onChange={(value) => setProgressForm({ ...progressForm, content: value })}
                rows={10}
                placeholder={showProgressForm === 'feedback' ? '' : 'Summarise what changed, what moved forward, and what comes next...'}
                disabled={progressSubmitting}
                autoFocus
                previewEmptyText={`Nothing to preview in this ${showProgressForm} yet.`}
              />
            </div>
            {showProgressForm === 'update' && (
              <SupportingVisualsFields
                slidesUrl={progressForm.slidesUrl}
                onSlidesChange={(value) => setProgressForm({ ...progressForm, slidesUrl: value })}
                visualUrls={progressForm.svgUrls}
                onUploadFiles={handleProgressSvgUpload}
                onRemoveVisual={removeProgressSvg}
                disabled={progressSubmitting}
                uploading={svgUploading}
                description="Figures, diagrams, charts, and photos to include with this update."
              />
            )}
            <div className="writing-form-actions">
              <button type="button" className="save-mode-btn tertiary" onClick={dismissProgressComposer} disabled={progressSubmitting || svgUploading}>Cancel</button>
              {showProgressForm === 'feedback' ? (
                <button type="button" className="save-mode-btn publish" onClick={() => handleProgressSubmit(false)} disabled={progressSubmitting || svgUploading}>
                  {progressSubmitting ? 'Saving...' : 'Save Feedback'}
                </button>
              ) : (
                <>
                  <button type="button" className="save-mode-btn quiet" onClick={() => handleProgressSubmit(false)} disabled={progressSubmitting || svgUploading}>Save quietly</button>
                  <button type="submit" className="save-mode-btn publish" disabled={progressSubmitting || svgUploading}>
                    {progressSubmitting ? 'Publishing...' : 'Publish'}
                  </button>
                </>
              )}
            </div>
          </form>
        </WritingModal>
      )}

      {showProjectSlidesForm && (
        <WritingModal
          title={project.slidesUrl || projectSvgUrls.length > 0 ? 'Edit Presentation Slides' : 'Add Presentation Slides'}
          subtitle="Add a slides link or upload visuals to display project-level material directly on this page."
          onClose={() => setShowProjectSlidesForm(false)}
        >
          <div className="cg-form">
            <SupportingVisualsFields
              slidesUrl={projectSlidesDraft}
              onSlidesChange={setProjectSlidesDraft}
              visualUrls={projectSvgDrafts}
              onUploadFiles={handleProjectSvgUpload}
              onRemoveVisual={removeProjectSvg}
              disabled={projectSlidesSaving}
              uploading={svgUploading}
              description="Figures, diagrams, charts, and photos to include with this project section."
            />
            <div className="writing-form-actions">
              <button type="button" className="save-mode-btn tertiary" onClick={() => setShowProjectSlidesForm(false)} disabled={projectSlidesSaving || svgUploading}>Cancel</button>
              <button type="button" className="save-mode-btn publish" onClick={saveProjectSlides} disabled={projectSlidesSaving || svgUploading}>Save Slides</button>
            </div>
          </div>
        </WritingModal>
      )}

      {editingEntry && (
        <WritingModal
          title={`Edit ${editingEntry.type === 'feedback' ? 'Feedback' : 'Update'}`}
          subtitle={editingEntry.type === 'feedback'
            ? 'Adjust the base audience and decide whether to include PIs and Reviewers.'
            : 'Use Save quietly for wording fixes and Publish when the revised entry should resurface in shared programme attention.'}
          onClose={() => setEditingEntry(null)}
        >
          <div className="cg-form">
            <div className="form-field">
              <label>Title</label>
              <input
                type="text"
                value={editingEntry.title}
                onChange={(e) => setEditingEntry({ ...editingEntry, title: e.target.value })}
                placeholder="Entry title"
                disabled={progressSubmitting}
              />
            </div>
            <div className="form-field">
              <label>Content</label>
              <LatexTextarea
                value={editingEntry.content}
                onChange={(value) => setEditingEntry({ ...editingEntry, content: value })}
                rows={12}
                disabled={progressSubmitting}
                autoFocus
                previewEmptyText="Nothing to preview yet."
              />
            </div>
            {editingEntry.type === 'feedback' && (
              <div className="form-field">
                <label>Audience</label>
                <FeedbackAudienceControls
                  baseAudience={normalizeFeedbackBaseAudience(editingEntry.baseAudience || editingEntry.audience)}
                  includeReviewers={Boolean(editingEntry.includeReviewers)}
                  onBaseChange={(value) => setEditingEntry({ ...editingEntry, baseAudience: value, audience: value })}
                  onToggleReviewers={(value) => setEditingEntry({ ...editingEntry, includeReviewers: value })}
                  disabled={progressSubmitting}
                />
              </div>
            )}
            {editingEntry.type === 'updates' && (
              <>
                <SupportingVisualsFields
                  slidesUrl={editingEntry.slidesUrl || ''}
                  onSlidesChange={(value) => setEditingEntry({ ...editingEntry, slidesUrl: value })}
                  visualUrls={editingEntry.svgUrls || []}
                  onUploadFiles={handleEditSvgUpload}
                  onRemoveVisual={removeEditingSvg}
                  disabled={progressSubmitting}
                  uploading={svgUploading}
                  description="Figures, diagrams, charts, and photos to include with this update."
                />
              </>
            )}
            {editingEntry.type === 'feedback' && editingEntry.author && (
              <div className="form-inline-note">Author: {editingEntry.author}</div>
            )}
            <div className="writing-form-actions">
              {editingEntry.type === 'feedback' ? (
                <button className="save-mode-btn publish" onClick={() => saveEntryEdit(false)} disabled={progressSubmitting || svgUploading}>Save Feedback</button>
              ) : (
                <>
                  <button className="save-mode-btn quiet" onClick={() => saveEntryEdit(false)} disabled={progressSubmitting || svgUploading}>Save quietly</button>
                  <button className="save-mode-btn publish" onClick={() => saveEntryEdit(true)} disabled={progressSubmitting || svgUploading}>Publish</button>
                </>
              )}
            </div>
          </div>
        </WritingModal>
      )}

      {showChallengeForm && (
        <WritingModal
          title="Add Challenge"
          subtitle=""
          onClose={() => setShowChallengeForm(false)}
        >
          {challengeFormError && <div className="form-error-box">{challengeFormError}</div>}
          <form onSubmit={(event) => handleChallengeSubmit(true, event)} className="cg-form">
            <div className="form-field">
              <label>Severity</label>
              <SeverityPillGroup
                value={challengeForm.severity}
                onChange={(value) => setChallengeForm({ ...challengeForm, severity: value })}
                disabled={challengeSubmitting}
              />
            </div>
            <div className="form-field">
              <label>Description</label>
              <LatexTextarea
                value={challengeForm.description}
                onChange={(value) => setChallengeForm({ ...challengeForm, description: value })}
                rows={10}
                disabled={challengeSubmitting}
                autoFocus
                placeholder={CHALLENGE_DESCRIPTION_PLACEHOLDER}
                previewEmptyText="Nothing to preview in this challenge yet."
              />
            </div>
            <div className="writing-form-actions">
              <button type="button" className="save-mode-btn tertiary" onClick={() => setShowChallengeForm(false)} disabled={challengeSubmitting}>Cancel</button>
              <button type="button" className="save-mode-btn quiet" onClick={() => handleChallengeSubmit(false)} disabled={challengeSubmitting}>Save quietly</button>
              <button type="submit" className="save-mode-btn publish" disabled={challengeSubmitting}>
                {challengeSubmitting ? 'Publishing...' : 'Publish'}
              </button>
            </div>
          </form>
        </WritingModal>
      )}

      {editingChallenge && (
        <WritingModal
          title="Edit Challenge"
          subtitle="Use Save quietly for wording improvements and Publish when the revised challenge should resurface in shared programme attention."
          onClose={() => setEditingChallenge(null)}
        >
          <div className="cg-form">
            <div className="form-field">
              <label>Severity</label>
              <SeverityPillGroup
                value={editingChallenge.severity}
                onChange={(value) => setEditingChallenge({ ...editingChallenge, severity: value })}
                disabled={editingChallengeSubmitting}
              />
            </div>
            <div className="form-field">
              <label>Description</label>
              <LatexTextarea
                value={editingChallenge.description}
                onChange={(value) => setEditingChallenge({ ...editingChallenge, description: value })}
                rows={10}
                disabled={editingChallengeSubmitting}
                autoFocus
                placeholder={CHALLENGE_DESCRIPTION_PLACEHOLDER}
                previewEmptyText="Nothing to preview in this challenge yet."
              />
            </div>
            <div className="writing-form-actions">
              <button className="save-mode-btn quiet" onClick={() => saveChallengeEdit(false)} disabled={editingChallengeSubmitting}>Save quietly</button>
              <button className="save-mode-btn publish" onClick={() => saveChallengeEdit(true)} disabled={editingChallengeSubmitting}>Publish</button>
            </div>
          </div>
        </WritingModal>
      )}

      {resolvingChallenge && (
        <WritingModal
          title="Resolve Challenge"
          subtitle="Add a short note if it helps explain how the challenge was worked through. Closing the loop shows that current challenges do get worked through."
          onClose={() => setResolvingChallenge(null)}
        >
          <div className="cg-form">
            <div className="form-inline-note">{resolvingChallenge.description}</div>
            <div className="form-field">
              <label>Resolution note</label>
              <LatexTextarea
                value={resolvingChallenge.resolutionNote}
                onChange={(value) => setResolvingChallenge({ ...resolvingChallenge, resolutionNote: value })}
                rows={8}
                disabled={resolvingChallengeSubmitting}
                autoFocus
                placeholder="Optional context for how this was resolved..."
                previewEmptyText="Nothing to preview in the resolution note yet."
              />
            </div>
            <div className="writing-form-actions">
              <button className="save-mode-btn tertiary" onClick={() => setResolvingChallenge(null)} disabled={resolvingChallengeSubmitting}>Cancel</button>
              <button className="save-mode-btn publish" onClick={handleResolveChallenge} disabled={resolvingChallengeSubmitting}>
                {resolvingChallengeSubmitting ? 'Resolving...' : 'Resolve Challenge'}
              </button>
            </div>
          </div>
        </WritingModal>
      )}
    </div>
  );
}
