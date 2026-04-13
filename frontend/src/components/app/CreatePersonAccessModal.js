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

export default function CreatePersonAccessModal({
  person,
  account,
  onClose,
  onCreated,
}) {
  const [email, setEmail] = useState(person?.email || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEmail(person?.email || '');
    setLoading(false);
    setError('');
    setResult(null);
    setCopied(false);
  }, [person?.email, person?.id]);

  if (!person) return null;

  const handleCreate = async () => {
    setError('');
    if (!email.trim()) {
      setError('Email is required before an invite can be created.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post(`/admin/people/${person.id}/create-account`, {
        email: email.trim(),
      });
      setResult(response.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(detail.map((item) => item.msg || JSON.stringify(item)).join(' '));
      } else {
        setError('The invite could not be created right now.');
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

  const inviteAlreadyPending = Boolean(account?.activationPending);
  const modalTitle = inviteAlreadyPending ? `Copy invite for ${person.name}` : `Invite ${person.name} to Yard`;
  const modalSubtitle = inviteAlreadyPending
    ? 'This refreshes the pending invite link so you can send it again.'
    : 'This creates the Yard login for the existing profile and gives you an invite link to share.';

  const footer = result ? (
    <div className="account-reset-actions">
      <button type="button" className="btn primary-btn" onClick={() => onCreated?.(result)}>
        Done
      </button>
    </div>
  ) : (
    <div className="account-reset-actions">
      <button type="button" className="btn secondary-btn" onClick={onClose} disabled={loading}>
        Cancel
      </button>
      <button type="button" className="btn primary-btn" onClick={handleCreate} disabled={loading}>
        {loading ? 'Preparing…' : inviteAlreadyPending ? 'Refresh invite' : 'Create invite'}
      </button>
    </div>
  );

  return (
    <WritingModal
      title={modalTitle}
      subtitle={modalSubtitle}
      onClose={result ? () => onCreated?.(result) : onClose}
      footer={footer}
      className="account-reset-modal"
    >
      <div className="account-reset-stack">
        {!result && (
          <>
            <div className="account-reset-summary">
              <div>
                <span className="account-reset-label">Profile</span>
                <strong>{person.name}</strong>
              </div>
              <div>
                <span className="account-reset-label">Current title</span>
                <strong>{person.title || 'No title set yet'}</strong>
              </div>
            </div>

            <div className="form-inline-note">
              Use the researcher’s institution email so the invite stays easy to recognise and resend if needed.
            </div>

            {error && <div className="auth-error">{error}</div>}

            <div className="form-field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. j.smith@lakemere.ac.uk"
                disabled={loading}
              />
            </div>
          </>
        )}

        {result && (
          <>
            <div className="form-inline-note">
              Share this link directly with the researcher. They will use it to choose their own password before they sign in.
            </div>
            <div className="account-reset-result">
              <div className="account-reset-password-row">
                <label htmlFor="created-access-password">Invite link</label>
                <div className="account-reset-password-field">
                  <input
                    id="created-access-password"
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
        )}
      </div>
    </WritingModal>
  );
}
