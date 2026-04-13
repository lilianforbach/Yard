import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, Link2, MailCheck } from 'lucide-react';
import api from '../api';

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

const invitePoints = [
  {
    icon: Link2,
    title: 'Use the invite once',
    description: 'This link is just here to let you choose your own Yard password securely.',
  },
  {
    icon: KeyRound,
    title: 'Set the password you want to keep',
    description: 'Once this is saved, your account becomes active and you will sign in normally from then on.',
  },
  {
    icon: MailCheck,
    title: 'Then sign in as usual',
    description: 'Use your institution email and the new password you choose here.',
  },
];

export default function ActivateAccountPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams]);
  const [invite, setInvite] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadInvite() {
      if (!token) {
        setInvite(null);
        setInviteError('This invite link is incomplete. Ask a Yard administrator for a new one.');
        setInviteLoading(false);
        return;
      }

      setInviteLoading(true);
      setInviteError('');

      try {
        const response = await api.get('/auth/activation-status', {
          params: { token },
        });
        if (ignore) return;
        setInvite(response.data);
      } catch (err) {
        if (ignore) return;
        const detail = err.response?.data?.detail;
        if (typeof detail === 'string') {
          setInviteError(detail);
        } else {
          setInviteError('This invite link could not be opened. Ask a Yard administrator for a new one.');
        }
      } finally {
        if (!ignore) {
          setInviteLoading(false);
        }
      }
    }

    loadInvite();
    return () => {
      ignore = true;
    };
  }, [token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');

    if (password.length < 10) {
      setSubmitError('Choose a password with at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError('The two password entries do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post('/auth/activate-account', {
        token,
        password,
      });
      const nextEmail = encodeURIComponent(response.data?.email || invite?.email || '');
      navigate(`/login?activated=1${nextEmail ? `&email=${nextEmail}` : ''}`, { replace: true });
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setSubmitError(detail);
      } else if (Array.isArray(detail)) {
        setSubmitError(detail.map((item) => item.msg || JSON.stringify(item)).join(' '));
      } else {
        setSubmitError('Your password could not be saved right now. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="activate-account-page" className="auth-shell">
      <div className="auth-backdrop" />

      <div className="auth-layout">
        <section className="auth-panel auth-panel-intro">
          <p className="auth-eyebrow">Yard invite</p>
          <h1>Activate your Yard login.</h1>
          <p className="auth-copy">
            Choose the password you want to keep using for Yard. After this step, you will sign in normally.
          </p>

          <div className="auth-feature-list">
            {invitePoints.map(({ icon: Icon, title, description }) => (
              <div key={title} className="auth-feature-card">
                <span className="auth-feature-icon">
                  <Icon size={18} />
                </span>
                <div>
                  <h2>{title}</h2>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="auth-panel auth-panel-form">
          <div className="auth-form-stack">
            <div className="auth-form-header">
              <h2>Set your password</h2>
              {invite && (
                <p>
                  Finish setting up <strong>{invite.name || invite.email}</strong>
                  {invite.email ? ` (${invite.email})` : ''}.
                </p>
              )}
              {!invite && !inviteLoading && !inviteError && (
                <p>Use this invite to set the password for your Yard account.</p>
              )}
              {invite?.expiresAt && (
                <div className="auth-next-note">
                  This invite stays valid until <strong>{formatDateTime(invite.expiresAt)}</strong>.
                </div>
              )}
            </div>

            {inviteError && <div className="auth-error">{inviteError}</div>}
            {submitError && <div className="auth-error">{submitError}</div>}

            {inviteLoading ? (
              <div className="auth-assistance">Checking your invite…</div>
            ) : inviteError ? (
              <p className="auth-assistance">
                Ask a Yard administrator for a fresh invite link, then return here.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="auth-form">
                <div className="auth-field">
                  <label htmlFor="activate-password">New password</label>
                  <div className="auth-password-wrap">
                    <input
                      id="activate-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={10}
                      placeholder="Choose a password"
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? 'Hide new password' : 'Show new password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="auth-field">
                  <label htmlFor="activate-confirm-password">Confirm password</label>
                  <div className="auth-password-wrap">
                    <input
                      id="activate-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                      minLength={10}
                      placeholder="Re-enter the password"
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowConfirmPassword((current) => !current)}
                      aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'}
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={submitting} className="auth-submit">
                  {submitting ? 'Saving...' : 'Activate account'}
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
