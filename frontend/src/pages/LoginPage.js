import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Eye, EyeOff, LayoutDashboard, Users, Microscope } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const featurePoints = [
  {
    icon: LayoutDashboard,
    title: "See what's happening",
    description: 'Follow projects, emerging ideas, publications, and events across the programme.',
  },
  {
    icon: Users,
    title: 'Find people and support',
    description: 'Find collaborators, expertise, and support across institutions, roles, and projects.',
  },
  {
    icon: Microscope,
    title: 'Help work develop',
    description: 'Help projects and early ideas stay visible, connected, and moving through updates, feedback, challenges and concept notes.',
  },
];

export default function LoginPage() {
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const prefilledEmail = useMemo(
    () => new URLSearchParams(location.search).get('email') || '',
    [location.search]
  );
  const activated = useMemo(
    () => new URLSearchParams(location.search).get('activated') === '1',
    [location.search]
  );

  const nextDestination = useMemo(
    () => new URLSearchParams(location.search).get('next'),
    [location.search]
  );
  const yardLogoLight = `${process.env.PUBLIC_URL}/yard-logo-light.svg`;

  useEffect(() => {
    if (prefilledEmail) {
      setEmail(prefilledEmail);
    }
  }, [prefilledEmail]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(detail.map((item) => item.msg || JSON.stringify(item)).join(' '));
      } else {
        setError('Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="login-page" className="auth-shell">
      <div className="auth-backdrop" />

      <div className="auth-layout">
        <section className="auth-panel auth-panel-intro">
          <p className="auth-eyebrow">Yard</p>
          <h1>The research home for computational gastronomy.</h1>
          <p className="auth-copy">
            Keep projects, emerging ideas, publications, and events in one place, so the programme stays connected between meetings.
          </p>

          <div className="auth-feature-list">
            {featurePoints.map(({ icon: Icon, title, description }) => (
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
              <h2>Sign in</h2>
              <p>Use your Yard email and password to sign in.</p>
              {nextDestination && (
                <div className="auth-next-note">
                  You’ll be returned to <strong>{nextDestination}</strong> after sign-in.
                </div>
              )}
              {activated && (
                <div className="auth-next-note">
                  Your password has been set. Sign in to enter Yard.
                </div>
              )}
            </div>

            {error && (
              <div data-testid="auth-error" className="auth-error">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  data-testid="login-email-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="your.email@institution.ac.uk"
                />
              </div>

              <div className="auth-field">
                <label htmlFor="login-password">Password</label>
                <div className="auth-password-wrap">
                  <input
                    id="login-password"
                    data-testid="login-password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button data-testid="login-submit-button" type="submit" disabled={loading} className="auth-submit">
                {loading ? 'Please wait...' : 'Sign in'}
              </button>
            </form>

            <p className="auth-assistance">
              Need access? Ask a Yard administrator to send you an invite. Need a reset? Ask them to reset your password.
            </p>
          </div>

          <div className="auth-brand-space">
            <img src={yardLogoLight} alt="Yard" className="auth-brand-logo" />
          </div>
        </section>
      </div>
    </div>
  );
}
