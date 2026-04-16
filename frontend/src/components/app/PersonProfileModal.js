import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import api from '../../api';
import { useData } from '../../contexts/DataContext';
import {
  buildPersonLinks,
  getPersonLinkLabel,
  getPersonLinkPlaceholder,
  normalizePersonLink,
  PERSON_LINK_TYPES,
} from '../../lib/personLinks';
import {
  buildSkillResolverContext,
  getSkillSuggestions,
  normalizeSkillKey,
  resolveCanonicalSkill,
} from '../../lib/skills';
import WritingModal from './WritingModal';

const ROLE_PILLS = [
  { value: 'pi', label: 'PI', roles: ['pi'] },
  { value: 'postdoc', label: 'Postdoc', roles: ['postdoc'] },
  { value: 'phd', label: 'PhD Student', roles: ['phd'] },
  { value: 'programme-team', label: 'Programme Team', roles: ['staff', 'coordinator', 'management'] },
];
const TITLE_DEFAULT_ROLES = new Set(['staff', 'coordinator', 'management']);

function createEmptyLinkDraft() {
  return {
    type: 'website',
    label: '',
    url: '',
  };
}

function buildDraft(person) {
  return {
    name: person?.name || '',
    role: person?.role || '',
    institution: person?.institution || '',
    title: person?.title || '',
    email: person?.email || '',
    researchDescription: person?.researchDescription || '',
    links: buildPersonLinks(person),
    skills: Array.from(new Set((person?.skills || []).map((skill) => skill?.trim()).filter(Boolean))),
    equipment: (person?.equipment || [])
      .filter((item) => item?.name?.trim())
      .map((item) => ({
        name: item.name.trim(),
        description: item.description?.trim() || '',
      })),
    showEmail: person?.showEmail !== false,
    showTeamsChat: person?.showTeamsChat !== false,
  };
}

function buildPayload(draft, canEditIdentity) {
  const links = Array.from(
    new Map(
      (draft.links || [])
        .map((link) => normalizePersonLink(link))
        .filter(Boolean)
        .map((link) => [`${link.type}|${link.label}|${link.url}`, link]),
    ).values(),
  );

  const payload = {
    title: draft.title.trim(),
    email: draft.email.trim(),
    researchDescription: draft.researchDescription.trim(),
    links,
    skills: Array.from(new Set((draft.skills || [])
      .map((skill) => skill?.trim())
      .filter(Boolean))),
    equipment: (draft.equipment || [])
      .map((item) => ({
        name: item.name?.trim() || '',
        description: item.description?.trim() || '',
      }))
      .filter((item) => item.name),
    showEmail: Boolean(draft.showEmail),
    showTeamsChat: Boolean(draft.showTeamsChat),
  };

  if (canEditIdentity) {
    payload.name = draft.name.trim();
    payload.role = draft.role;
    payload.institution = draft.institution;
  }

  return payload;
}

function getRolePillValue(role) {
  return ROLE_PILLS.find((option) => option.roles.includes(role))?.value || 'programme-team';
}

export default function PersonProfileModal({
  person,
  institutions = [],
  canEditIdentity = false,
  onClose,
  onSaved,
}) {
  const { people } = useData();
  const [draft, setDraft] = useState(() => buildDraft(person));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [skillTaxonomy, setSkillTaxonomy] = useState({});
  const [newSkill, setNewSkill] = useState('');
  const [newEquipment, setNewEquipment] = useState({ name: '', description: '' });
  const [showTitleField, setShowTitleField] = useState(() => (
    Boolean(person?.title?.trim()) || TITLE_DEFAULT_ROLES.has(person?.role)
  ));

  useEffect(() => {
    const nextDraft = buildDraft(person);
    setDraft(nextDraft);
    setLoading(false);
    setError('');
    setNewSkill('');
    setNewEquipment({ name: '', description: '' });
    setShowTitleField(Boolean(person?.title?.trim()) || TITLE_DEFAULT_ROLES.has(person?.role));
  }, [person]);

  useEffect(() => {
    api.get('/skill-taxonomy').then((res) => {
      setSkillTaxonomy(res.data || {});
    }).catch(() => {});
  }, []);

  const initialDraft = useMemo(() => buildDraft(person), [person]);
  const hasChanges = useMemo(() => (
    JSON.stringify(buildPayload(draft, canEditIdentity)) !== JSON.stringify(buildPayload(initialDraft, canEditIdentity))
  ), [canEditIdentity, draft, initialDraft]);
  const skillResolver = useMemo(() => (
    buildSkillResolverContext(people, skillTaxonomy)
  ), [people, skillTaxonomy]);
  const canonicalDraftSkill = useMemo(() => (
    resolveCanonicalSkill(newSkill, skillResolver)
  ), [newSkill, skillResolver]);
  const skillSuggestions = useMemo(() => {
    const existing = new Set((draft.skills || []).map((skill) => normalizeSkillKey(skill)));
    return getSkillSuggestions(newSkill, skillResolver)
      .filter((suggestion) => !existing.has(normalizeSkillKey(suggestion.value)))
      .filter((suggestion) => normalizeSkillKey(suggestion.value) !== normalizeSkillKey(canonicalDraftSkill));
  }, [canonicalDraftSkill, draft.skills, newSkill, skillResolver]);
  const shouldShowTitleField = showTitleField || Boolean(draft.title.trim()) || TITLE_DEFAULT_ROLES.has(draft.role);
  const canHideTitleField = shouldShowTitleField && !draft.title.trim() && !TITLE_DEFAULT_ROLES.has(draft.role);

  useEffect(() => {
    if (draft.title.trim() || TITLE_DEFAULT_ROLES.has(draft.role)) {
      setShowTitleField(true);
    }
  }, [draft.role, draft.title]);

  if (!person) return null;

  const handleAddSkill = () => {
    const trimmed = newSkill.trim();
    if (!trimmed) return;

    const canonicalSkill = resolveCanonicalSkill(trimmed, skillResolver);
    const existing = new Set((draft.skills || []).map((skill) => normalizeSkillKey(skill)));
    if (existing.has(normalizeSkillKey(canonicalSkill))) {
      setNewSkill('');
      return;
    }

    setDraft((current) => ({
      ...current,
      skills: [...current.skills, canonicalSkill],
    }));
    setNewSkill('');
  };

  const handleRemoveSkill = (skillToRemove) => {
    setDraft((current) => ({
      ...current,
      skills: current.skills.filter((skill) => skill !== skillToRemove),
    }));
  };

  const handleAddEquipment = () => {
    const name = newEquipment.name.trim();
    if (!name) return;

    setDraft((current) => ({
      ...current,
      equipment: [
        ...current.equipment,
        {
          name,
          description: newEquipment.description.trim(),
        },
      ],
    }));
    setNewEquipment({ name: '', description: '' });
  };

  const handleRemoveEquipment = (index) => {
    setDraft((current) => ({
      ...current,
      equipment: current.equipment.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleRolePillClick = (value) => {
    if (value === 'programme-team') {
      setDraft((current) => ({
        ...current,
        role: ['staff', 'coordinator', 'management'].includes(current.role) ? current.role : 'staff',
      }));
      return;
    }

    setDraft((current) => ({
      ...current,
      role: value,
    }));
  };

  const handleAddLink = () => {
    setDraft((current) => ({
      ...current,
      links: [...(current.links || []), createEmptyLinkDraft()],
    }));
  };

  const handleUpdateLink = (index, field, value) => {
    setDraft((current) => ({
      ...current,
      links: (current.links || []).map((link, itemIndex) => (
        itemIndex === index ? { ...link, [field]: value } : link
      )),
    }));
  };

  const handleLinkTypeChange = (index, value) => {
    setDraft((current) => ({
      ...current,
      links: (current.links || []).map((link, itemIndex) => {
        if (itemIndex !== index) return link;
        return {
          ...link,
          type: value,
          label: value === 'other' ? link.label : '',
        };
      }),
    }));
  };

  const handleRemoveLink = (index) => {
    setDraft((current) => ({
      ...current,
      links: (current.links || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = buildPayload(draft, canEditIdentity);
      const response = await api.put(`/people/${person.id}`, payload);
      await onSaved?.(response.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(detail.map((item) => item.msg || JSON.stringify(item)).join(' '));
      } else {
        setError('The profile could not be updated right now.');
      }
    } finally {
      setLoading(false);
    }
  };

  const footer = (
    <div className="writing-form-actions profile-editor-footer">
      <button type="button" className="btn secondary-btn profile-editor-cancel-btn" onClick={onClose} disabled={loading}>
        Cancel
      </button>
      <button
        type="button"
        className={`save-mode-btn quiet profile-editor-save-btn ${hasChanges && !loading ? 'is-ready' : ''}`}
        onClick={handleSave}
        disabled={loading || !hasChanges}
      >
        {loading ? 'Saving…' : 'Save'}
      </button>
    </div>
  );

  return (
    <WritingModal
      title={`Edit profile for ${person.name}`}
      subtitle="Keep this light-touch. Highlight the few things people should know, and the few things you would be happy to be contacted about."
      onClose={onClose}
      footer={footer}
      className="profile-editor-modal person-profile-editor-modal"
    >
      <div className="profile-editor-form">
        <div className="profile-editor-section profile-editor-section-subtle">
          <div className="profile-editor-section-header">
            <div>
              <h3>Profile details</h3>
            </div>
          </div>

          {!canEditIdentity && (
            <div className="form-inline-note">
              Role and institution are managed centrally. Use this editor for your profile details, contact settings, research interests, shared expertise, equipment support, and optional links.
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          {canEditIdentity && (
            <div className="profile-editor-grid">
              <div className="form-field">
                <label>Full Name</label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                  disabled={loading}
                />
              </div>
              <div className="form-field profile-editor-span-full">
                <label>Role</label>
                <div className="profile-editor-pill-group">
                  {ROLE_PILLS.map((option) => {
                    const active = getRolePillValue(draft.role) === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`profile-editor-pill ${active ? 'active' : ''}`}
                        onClick={() => handleRolePillClick(option.value)}
                        disabled={loading}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="form-field profile-editor-span-full">
                <label>Institution</label>
                <div className="profile-editor-pill-group">
                  {institutions.map((institution) => (
                    <button
                      key={institution.id}
                      type="button"
                      className={`profile-editor-pill ${draft.institution === institution.id ? 'active' : ''}`}
                      onClick={() => setDraft((current) => ({ ...current, institution: institution.id }))}
                      disabled={loading}
                    >
                      {institution.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="profile-editor-subsection">
            <div className="profile-editor-grid">
              {shouldShowTitleField ? (
                <div className="form-field profile-editor-span-full">
                  <div className="profile-editor-field-header">
                    <label>Title</label>
                    {canHideTitleField && (
                      <button
                        type="button"
                        className="profile-editor-field-remove"
                        onClick={() => setShowTitleField(false)}
                        disabled={loading}
                      >
                        Hide
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
                    placeholder="e.g. RETO or Programme Manager"
                    disabled={loading}
                  />
                </div>
              ) : (
                <div className="profile-editor-actions-row profile-editor-span-full">
                  <button
                    type="button"
                    className="action-btn small secondary profile-editor-add-link-btn"
                    onClick={() => setShowTitleField(true)}
                    disabled={loading}
                  >
                    <Plus size={14} /> Add Title
                  </button>
                </div>
              )}
              <div className="form-field profile-editor-span-full profile-editor-contact-field">
                <div className="profile-editor-field-header">
                  <label>Email</label>
                </div>
                <div className="profile-editor-contact-layout">
                  <div className="profile-editor-contact-main">
                    <input
                      type="email"
                      className="profile-editor-readonly-input"
                      value={draft.email}
                      placeholder="e.g. j.smith@lakemere.ac.uk"
                      readOnly
                      aria-readonly="true"
                    />
                    <p className="profile-editor-field-note">Managed with Yard access</p>
                  </div>
                  <div className="profile-editor-contact-controls">
                    <div className="profile-editor-contact-controls-heading">Visibility</div>
                    <div className="profile-editor-inline-switch-row">
                      <span className="profile-editor-inline-switch-label">Email</span>
                      <button
                        type="button"
                        className={`profile-editor-switch ${draft.showEmail ? 'active' : ''}`}
                        onClick={() => setDraft((current) => ({ ...current, showEmail: !current.showEmail }))}
                        disabled={loading}
                        role="switch"
                        aria-checked={draft.showEmail}
                        aria-label="Show email on profile"
                      >
                        <span className="profile-editor-switch-track" aria-hidden="true">
                          <span className="profile-editor-switch-thumb" />
                        </span>
                      </button>
                    </div>
                    <div className="profile-editor-inline-switch-row">
                      <span className="profile-editor-inline-switch-label">Teams Chat</span>
                      <button
                        type="button"
                        className={`profile-editor-switch ${draft.showTeamsChat ? 'active' : ''}`}
                        onClick={() => setDraft((current) => ({ ...current, showTeamsChat: !current.showTeamsChat }))}
                        disabled={loading}
                        role="switch"
                        aria-checked={draft.showTeamsChat}
                        aria-label="Show Teams chat on profile"
                      >
                        <span className="profile-editor-switch-track" aria-hidden="true">
                          <span className="profile-editor-switch-thumb" />
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="profile-editor-subsection">
            <div className="form-field profile-editor-span-full">
              <label>Research interests</label>
              <textarea
                rows={6}
                className="profile-editor-research-textarea"
                value={draft.researchDescription}
                onChange={(e) => setDraft((current) => ({ ...current, researchDescription: e.target.value }))}
                placeholder="Describe the questions, themes, or approaches you want people in the programme to associate with your work."
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <div className="profile-editor-section">
          <div className="profile-editor-section-header">
            <div>
              <h3>Happy to help with</h3>
              <p>Add the things you would be happy for others in the programme to contact you about.</p>
            </div>
          </div>

          <div className="profile-editor-token-field">
            {draft.skills.length > 0 && (
              <div className="profile-editor-chip-list">
              {draft.skills.map((skill) => (
                <span key={skill} className="profile-editor-chip">
                  {skill}
                  <button
                    type="button"
                    className="profile-editor-chip-remove"
                    onClick={() => handleRemoveSkill(skill)}
                    disabled={loading}
                    aria-label={`Remove ${skill}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              </div>
            )}
            <input
              type="text"
              className="profile-editor-token-input"
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddSkill();
                }
              }}
              disabled={loading}
            />
            <button type="button" className="action-btn small profile-editor-token-add" onClick={handleAddSkill} disabled={loading || !newSkill.trim()}>
              <Plus size={14} /> Add
            </button>
          </div>

          {newSkill.trim() && canonicalDraftSkill && normalizeSkillKey(canonicalDraftSkill) !== normalizeSkillKey(newSkill) && (
            <p className="skill-entry-note">
              Will be saved as <strong>{canonicalDraftSkill}</strong>.
            </p>
          )}

          {skillSuggestions.length > 0 && (
            <div className="skill-suggestion-list">
              {skillSuggestions.map((suggestion) => (
                <button
                  key={suggestion.value}
                  type="button"
                  className="skill-suggestion-chip"
                  onClick={() => setNewSkill(suggestion.value)}
                  disabled={loading}
                >
                  {suggestion.value}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="profile-editor-section">
          <div className="profile-editor-section-header">
            <div>
              <h3>Can advise on equipment</h3>
              <p>List equipment or setups you would be happy to advise on or help others navigate.</p>
            </div>
          </div>

          {draft.equipment.length > 0 && (
            <div className="profile-editor-equipment-list">
              {draft.equipment.map((item, index) => (
                <div key={`${item.name}-${index}`} className="profile-editor-equipment-item">
                  <div className="profile-editor-equipment-copy">
                    <div className="profile-editor-equipment-name">{item.name}</div>
                    {item.description && <div className="profile-editor-equipment-desc">{item.description}</div>}
                  </div>
                  <button
                    type="button"
                    className="profile-editor-chip-remove standalone"
                    onClick={() => handleRemoveEquipment(index)}
                    disabled={loading}
                    aria-label={`Remove ${item.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="profile-editor-grid">
            <div className="form-field">
              <label>Equipment or setup</label>
              <input
                type="text"
                value={newEquipment.name}
                onChange={(e) => setNewEquipment((current) => ({ ...current, name: e.target.value }))}
                placeholder="e.g. PerkinElmer Spectrum Two FT-IR"
                disabled={loading}
              />
            </div>
            <div className="form-field">
              <label>How you can help <span className="form-optional">(optional)</span></label>
              <input
                type="text"
                value={newEquipment.description}
                onChange={(e) => setNewEquipment((current) => ({ ...current, description: e.target.value }))}
                placeholder="e.g. Rapid food quality screening"
                disabled={loading}
              />
            </div>
          </div>

          <div className="profile-editor-actions-row">
            <button type="button" className="action-btn small" onClick={handleAddEquipment} disabled={loading || !newEquipment.name.trim()}>
              <Plus size={14} /> Add Equipment
            </button>
          </div>
        </div>

        <div className="profile-editor-section">
          <div className="profile-editor-section-header">
            <div>
              <h3>Links</h3>
              <p>Add the external links that you would like people to visit to know more about your work.</p>
            </div>
          </div>

          {draft.links.length > 0 && (
            <div className="profile-editor-link-list">
              {draft.links.map((link, index) => (
                <div key={`${link.type}-${index}`} className="profile-editor-link-row">
                  <div className="form-field profile-editor-link-type-field">
                    <label>Type</label>
                    <select
                      value={link.type}
                      onChange={(e) => handleLinkTypeChange(index, e.target.value)}
                      disabled={loading}
                    >
                      {PERSON_LINK_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  {link.type === 'other' && (
                    <div className="form-field profile-editor-link-label-field">
                      <label>Label</label>
                      <input
                        type="text"
                        value={link.label || ''}
                        onChange={(e) => handleUpdateLink(index, 'label', e.target.value)}
                        placeholder="e.g. Lab booking page"
                        disabled={loading}
                      />
                    </div>
                  )}

                  <div className={`form-field profile-editor-link-url-field ${link.type === 'other' ? 'with-custom-label' : 'full-width'}`}>
                    <div className="profile-editor-field-header">
                      <label>{link.type === 'other' ? (link.label?.trim() || 'Link') : getPersonLinkLabel(link)}</label>
                      <button
                        type="button"
                        className="profile-editor-field-remove"
                        onClick={() => handleRemoveLink(index)}
                        disabled={loading}
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      type="text"
                      value={link.url || ''}
                      onChange={(e) => handleUpdateLink(index, 'url', e.target.value)}
                      placeholder={getPersonLinkPlaceholder(link.type)}
                      disabled={loading}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="profile-editor-actions-row">
            <button
              type="button"
              className="action-btn small secondary profile-editor-add-link-btn"
              onClick={handleAddLink}
              disabled={loading}
            >
              <Plus size={14} /> Add Link
            </button>
          </div>
        </div>

      </div>
    </WritingModal>
  );
}
