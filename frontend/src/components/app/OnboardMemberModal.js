import React, { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import api from '../../api';
import WritingModal from './WritingModal';

function formatDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createInitialForm(institutions) {
  return {
    name: '',
    role: '',
    institution: '',
    title: '',
    email: '',
  };
}

export default function OnboardMemberModal({
  institutions,
  onClose,
  onComplete,
}) {
  const [form, setForm] = useState(() => createInitialForm(institutions));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setForm(createInitialForm(institutions));
    setLoading(false);
    setError('');
    setResult(null);
    setCopied(false);
  }, [institutions]);

  const handleSubmit = async () => {
    setError('');
    if (!form.name.trim() || !form.role || !form.institution || !form.email.trim()) {
      setError('Name, role, institution, and email are required.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/admin/onboard-member', {
        name: form.name.trim(),
        role: form.role,
        institution: form.institution,
        title: form.title.trim(),
        email: form.email.trim(),
      });
      setResult(response.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(detail.map((item) => item.msg || JSON.stringify(item)).join(' '));
      } else {
        setError('The member could not be onboarded right now.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.inviteLink) return;
    try {
      await navigator.clipboard.writeText(result.inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const footer = result ? (
    <div className="account-reset-actions">
      <button
        type="button"
        className="btn secondary-btn"
        onClick={() => onComplete?.(result, { openProfile: false })}
      >
        Done
      </button>
      <button
        type="button"
        className="btn primary-btn"
        onClick={() => onComplete?.(result, { openProfile: true })}
      >
        Open profile
      </button>
    </div>
  ) : (
    <div className="account-reset-actions">
      <button type="button" className="btn secondary-btn" onClick={onClose} disabled={loading}>
        Cancel
      </button>
      <button type="button" className="btn primary-btn" onClick={handleSubmit} disabled={loading}>
        {loading ? 'Creating…' : 'Create member'}
      </button>
    </div>
  );

  return (
    <WritingModal
      title="Onboard member"
      subtitle="Create the profile and the Yard login together, then share the invite link so the member can set their own password."
      onClose={result ? () => onComplete?.(result, { openProfile: false }) : onClose}
      footer={footer}
      className="profile-editor-modal"
    >
      <div className="profile-editor-form">
        {!result && (
          <>
            <div className="form-inline-note">
              Keep the first pass light. The profile only needs enough structure for the person to activate their login and finish the details later.
            </div>

            {error && <div className="auth-error">{error}</div>}

            <div className="profile-editor-grid">
              <div className="form-field">
                <label>Full Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                  placeholder="e.g. Dr. Jane Smith"
                  disabled={loading}
                />
              </div>
              <div className="form-field">
                <label>Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((current) => ({ ...current, role: e.target.value }))}
                  disabled={loading}
                >
                  <option value="">Select role...</option>
                  <option value="pi">PI</option>
                  <option value="postdoc">Postdoc</option>
                  <option value="phd">PhD Student</option>
                  <option value="coordinator">Programme Team</option>
                </select>
              </div>
              <div className="form-field">
                <label>Institution</label>
                <select
                  value={form.institution}
                  onChange={(e) => setForm((current) => ({ ...current, institution: e.target.value }))}
                  disabled={loading}
                >
                  <option value="">Select institution...</option>
                  {institutions.map((institution) => (
                    <option key={institution.id} value={institution.id}>{institution.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Title <span className="form-optional">(optional)</span></label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))}
                  placeholder="e.g. Postdoctoral Fellow - Flavour Modelling"
                  disabled={loading}
                />
              </div>
              <div className="form-field profile-editor-span-full">
                <label>
                  Email
                  <span className="form-optional">(required)</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
                  placeholder="e.g. j.smith@lakemere.ac.uk"
                  disabled={loading}
                />
              </div>
            </div>
          </>
        )}

        {result && (
          <div className="account-reset-stack">
            <div className="account-reset-summary">
              <div>
                <span className="account-reset-label">Profile</span>
                <strong>{result.person?.name}</strong>
              </div>
              <div>
                <span className="account-reset-label">Login</span>
                <strong>{result.user ? 'Invite ready' : 'Not created'}</strong>
              </div>
            </div>

            {result.user ? (
              <>
                <div className="form-inline-note">
                  Copy this invite link and send it to the new member. They will use it to choose their own password before signing in.
                </div>
                <div className="account-reset-result">
                  <div className="account-reset-password-row">
                    <label htmlFor="onboard-invite-link">Invite link</label>
                    <div className="account-reset-password-field">
                      <input
                        id="onboard-invite-link"
                        type="text"
                        readOnly
                        value={result.inviteLink}
                      />
                      <button
                        type="button"
                        className="btn secondary-btn account-reset-copy"
                        onClick={handleCopy}
                      >
                        <Copy size={14} />
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="account-reset-meta">
                    <p>Expires {formatDateTime(result.expiresAt)}.</p>
                    <p>This link will not be shown again after this window closes.</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="form-inline-note">
                The member could not be prepared for activation right now.
              </div>
            )}
          </div>
        )}
      </div>
    </WritingModal>
  );
}
