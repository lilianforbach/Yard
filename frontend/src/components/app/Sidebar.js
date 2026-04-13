import React, { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useAuth } from '../../contexts/AuthContext';
import { LayoutDashboard, Users, Microscope, Repeat2, Lightbulb, BookOpen, Calendar, Library, PanelLeft, LogOut, X, Sun, Moon } from 'lucide-react';

const primaryNav = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'people', label: 'People', icon: Users },
  { id: 'projects', label: 'Projects', icon: Microscope },
];

const reviewNavItem = { id: 'review', label: 'Review', icon: Repeat2 };

const secondaryNav = [
  { id: 'conceptnotes', label: 'Concept Notes', icon: Lightbulb },
  { id: 'publications', label: 'Publications', icon: BookOpen },
  { id: 'events', label: 'Events', icon: Calendar },
  { id: 'resources', label: 'Getting Started', icon: Library },
];

export default function Sidebar({ activeSection, onNavigate, showReview = false, collapsed, mobile, mobileOpen, onToggle, userEmail = '' }) {
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navItems = showReview ? [...primaryNav, reviewNavItem] : primaryNav;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = mounted && theme === 'dark' ? 'dark' : 'light';
  const toggleTheme = () => setTheme(activeTheme === 'dark' ? 'light' : 'dark');

  return (
    <aside data-testid="sidebar" className={`cg-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-header">
        {!collapsed && (
          <>
            <h1>Yard</h1>
            <p>Programme workspace</p>
          </>
        )}
      </div>
      <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
        {navItems.map(item => (
          <button
            key={item.id}
            type="button"
            data-testid={`nav-${item.id}`}
            className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            aria-current={activeSection === item.id ? 'page' : undefined}
          >
            <item.icon size={20} />
            {!collapsed && <span className="nav-item-label">{item.label}</span>}
          </button>
        ))}
        {secondaryNav.map(item => (
          <button
            key={item.id}
            type="button"
            data-testid={`nav-${item.id}`}
            className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            aria-current={activeSection === item.id ? 'page' : undefined}
          >
            <item.icon size={20} />
            {!collapsed && <span className="nav-item-label">{item.label}</span>}
          </button>
        ))}
      </nav>
      <button data-testid="sidebar-toggle" className="sidebar-collapse" onClick={onToggle}>
        {mobile ? (
          <X size={20} />
        ) : (
          <PanelLeft size={20} />
        )}
      </button>
      <div className="sidebar-footer">
        {!collapsed && (
          <div className="theme-switch">
            <span className="theme-switch-label">Appearance</span>
            <div className="theme-switch-group" role="group" aria-label="Theme">
              <button
                type="button"
                className={`theme-switch-btn ${activeTheme === 'light' ? 'active' : ''}`}
                onClick={() => setTheme('light')}
                aria-pressed={activeTheme === 'light'}
              >
                <Sun size={14} />
                <span>Light</span>
              </button>
              <button
                type="button"
                className={`theme-switch-btn ${activeTheme === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
                aria-pressed={activeTheme === 'dark'}
              >
                <Moon size={14} />
                <span>Dark</span>
              </button>
            </div>
          </div>
        )}
        {collapsed && (
          <button
            type="button"
            className="theme-switch-icon-btn"
            onClick={toggleTheme}
            title={`Switch to ${activeTheme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label={`Switch to ${activeTheme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {activeTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        )}
        {!collapsed && userEmail && (
          <div className="sidebar-user">
            <span className="sidebar-user-label">Signed in as</span>
            <span className="sidebar-user-email" data-testid="user-email">{userEmail}</span>
          </div>
        )}
        {!collapsed && (
          <button data-testid="logout-button" className="logout-btn" onClick={logout}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        )}
        {collapsed && (
          <button data-testid="logout-button-collapsed" className="logout-btn" onClick={logout} title="Sign Out">
            <LogOut size={16} />
          </button>
        )}
        {!collapsed && (
          <p className="sidebar-footer-text">
            Yard • Research programme workspace
          </p>
        )}
      </div>
    </aside>
  );
}
