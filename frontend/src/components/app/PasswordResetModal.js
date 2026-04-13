import React, { useEffect, useState } from 'react';
import { Copy, RefreshCcw } from 'lucide-react';
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

export default function PasswordResetModal({
  account,
  onClose,
  onResetComplete,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(false);
    setError('');
    setResult(null);
    setCopied(false);
  }, [account?.id]);

  if (!account) return null;

  const handleReset = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.post(`/admin/users/${account.id}/reset-password`, {});
      setResult(response.data);
      onResetComplete?.(response.data.user);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else {
        setError('The temporary password could not be generated.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const footer = result ? (
    <div className="account-reset-actions">
      <button type="button" className="btn secondary-btn" onClick={onClose}>
        Done
      </button>
    </div>
  ) : (
    <div className="account-reset-actions">
      <button type="button" className="btn secondary-btn" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn primary-btn" onClick={handleReset} disabled={loading}>
        {loading ? 'Generating…' : 'Generate temporary password'}
      </button>
    </div>
  );

  return (
    <WritingModal
      title={`Reset password for ${account.email}`}
      subtitle="This will replace the current password, invalidate active sessions, and require a new password at next sign-in."
      onClose={onClose}
      footer={footer}
      className="account-reset-modal"
    >
      <div className="account-reset-stack">
        <div className="account-reset-summary">
          <div>
            <span className="account-reset-label">Account</span>
            <strong>{account.email}</strong>
          </div>
          <div>
            <span className="account-reset-label">Profile</span>
            <strong>{account.linkedPersonName || account.name || 'No linked profile'}</strong>
          </div>
        </div>

        {!result && (
          <div className="form-inline-note">
            The generated password will be shown once in this window. Share it through a direct channel, then ask the user to change it immediately after signing in.
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}

        {result && (
          <div className="account-reset-result">
            <div className="account-reset-password-row">
              <label htmlFor="temporary-password-value">Temporary password</label>
              <div className="account-reset-password-field">
                <input
                  id="temporary-password-value"
                  type="text"
                  readOnly
                  value={result.temporaryPassword}
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
              <p>This password will not be shown again after this window closes.</p>
            </div>
          </div>
        )}

        {!result && account.mustChangePassword && (
          <div className="account-reset-status">
            <RefreshCcw size={14} />
            <span>
              A temporary password is already active
              {account.temporaryPasswordExpiresAt ? ` until ${formatDateTime(account.temporaryPasswordExpiresAt)}` : ''}.
              Resetting again will replace it immediately.
            </span>
          </div>
        )}
      </div>
    </WritingModal>
  );
}
