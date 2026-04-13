import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, ShieldCheck, TimerReset } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const passwordResetPoints = [
  {
    icon: KeyRound,
    title: 'This password is temporary',
    description: 'Choose a new password that only you know before continuing into the programme workspace.',
  },
  {
    icon: TimerReset,
    title: 'Reset links stay short-lived',
    description: 'Temporary passwords expire, so this step keeps access tidy and reduces follow-up admin work.',
  },
  {
    icon: ShieldCheck,
    title: 'You will return straight to the app',
    description: 'Once the new password is saved, Yard signs you back in and returns you to your work.',
  },
];

export default function ForcePasswordChangePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { changePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const nextDestination = useMemo(
    () => new URLSearchParams(location.search).get('next') || '/dashboard',
    [location.search]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (newPassword.length < 10) {
      setError('Choose a password with at least 10 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two password entries do not match.');
      return;
    }

    setLoading(true);
    try {
      await changePassword(newPassword);
      navigate(nextDestination, { replace: true });
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(detail.map((item) => item.msg || JSON.stringify(item)).join(' '));
      } else {
        setError('The new password could not be saved. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="force-password-page" className="auth-shell">
      <div className="auth-backdrop" />

      <div className="auth-layout">
        <section className="auth-panel auth-panel-intro">
          <p className="auth-eyebrow">Password reset</p>
          <h1>Choose a new password to continue.</h1>
          <p className="auth-copy">
            This only happens after an administrator has reset your access. Once you save a new password, you will go straight back into Yard.
          </p>

          <div className="auth-feature-list">
            {passwordResetPoints.map(({ icon: Icon, title, description }) => (
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
          <div className="auth-form-header">
            <h2>Set new password</h2>
            <p>Choose something you can keep using after this temporary password is retired.</p>
            {nextDestination && nextDestination !== '/dashboard' && (
              <div className="auth-next-note">
                You’ll be returned to <strong>{nextDestination}</strong> afterwards.
              </div>
            )}
          </div>

          {error && (
            <div data-testid="force-password-error" className="auth-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-field">
              <label htmlFor="new-password">New password</label>
              <div className="auth-password-wrap">
                <input
                  id="new-password"
                  data-testid="new-password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  minLength={10}
                  placeholder="Choose a new password"
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
              <label htmlFor="confirm-password">Confirm new password</label>
              <div className="auth-password-wrap">
                <input
                  id="confirm-password"
                  data-testid="confirm-password-input"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  minLength={10}
                  placeholder="Re-enter the new password"
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

            <button
              data-testid="force-password-submit-button"
              type="submit"
              disabled={loading}
              className="auth-submit"
            >
              {loading ? 'Saving...' : 'Save new password'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
