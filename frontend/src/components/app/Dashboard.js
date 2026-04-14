import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Calendar,
  Compass,
  FileText,
  Flag,
  Lightbulb,
} from 'lucide-react';
import api from '../../api';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../lib/constants';
import {
  getConceptNoteContributorLabel,
  getConceptNoteFrontstageState,
  getConceptNoteProgressSummary,
  getConceptNoteSortDate,
} from '../../lib/conceptNotes';
import { SectionNotice, SectionSkeleton } from './SectionState';
import { canAccessMaintenance, formatDaysAgo, getMaintenanceSnapshot } from '../../lib/maintenance';
import { getLinkedPerson } from '../../lib/roleAccess';
import { canAccessProjectReview } from '../../lib/projectReview';
import PasswordResetModal from './PasswordResetModal';

function parseDateValue(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinLastMonths(value, months = 3) {
  const parsed = parseDateValue(value);
  if (!parsed) return false;

  const now = new Date();
  const threshold = new Date(now);
  threshold.setMonth(now.getMonth() - months);

  return parsed <= now && parsed >= threshold;
}

function getProjectShortName(title = '') {
  if (!title) return '';
  const [shortName] = title.split(':');
  return shortName?.trim() || title;
}

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

function getAccountAccessStatus(account) {
  if (account.activationPending) {
    if (account.activationExpired) {
      return 'Invite expired';
    }
    return account.activationExpiresAt
      ? `Invite pending until ${formatDateTime(account.activationExpiresAt)}`
      : 'Invite pending';
  }

  if (account.mustChangePassword) {
    if (account.temporaryPasswordExpired) {
      return 'Temporary password expired';
    }
    return account.temporaryPasswordExpiresAt
      ? `Temporary password active until ${formatDateTime(account.temporaryPasswordExpiresAt)}`
      : 'Temporary password active';
  }

  if (account.passwordChangedAt) {
    return `Password changed ${formatDateTime(account.passwordChangedAt)}`;
  }

  return 'Password has not been changed yet';
}

function DashboardStreamCard({
  title,
  items,
  emptyText,
  icon,
  tone,
}) {
  const Icon = icon;

  return (
    <section className={`dash-stream-card tone-${tone}`}>
      <header className="dash-stream-card-header">
        <h3 className="dash-stream-card-title">{title}</h3>
      </header>

      {items.length > 0 ? (
        <div className="dash-stream-scroll">
          {items.map((item) => {
            const content = (
              <>
                <span className={`dash-stream-item-icon tone-${tone}`}>
                  {item.iconNode || <Icon size={15} strokeWidth={1.9} />}
                </span>
                <div className="dash-stream-item-body">
                  <div className="dash-stream-item-title">{item.title}</div>
                  {item.meta && <div className="dash-stream-item-meta">{item.meta}</div>}
                  {item.metaSecondary && <div className="dash-stream-item-submeta">{item.metaSecondary}</div>}
                </div>
              </>
            );

            if (typeof item.onClick === 'function') {
              return (
                <button
                  key={item.key}
                  type="button"
                  className="dash-stream-item clickable"
                  onClick={item.onClick}
                >
                  {content}
                </button>
              );
            }

            return (
              <div key={item.key} className="dash-stream-item">
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="dash-stream-empty">{emptyText}</div>
      )}
    </section>
  );
}

function AccountAccessCard({
  accounts,
  currentUserId,
  loading,
  error,
  onRetry,
  onSelectAccount,
}) {
  return (
    <section className="maintenance-card maintenance-card-accounts">
      <div className="maintenance-card-header">
        <div>
          <h4>Account access</h4>
          <p>Reset temporary passwords for people who already have active Yard access. First-time invites are handled from People.</p>
        </div>
        <span className="maintenance-count">{accounts.length}</span>
      </div>

      {loading ? (
        <p className="maintenance-empty">Loading user accounts…</p>
      ) : error ? (
        <div className="maintenance-empty maintenance-empty-with-action">
          <span>{error}</span>
          <button type="button" className="btn secondary-btn maintenance-inline-action" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : accounts.length > 0 ? (
        <div className="maintenance-item-list maintenance-account-list">
          {accounts.map((account) => {
            const isCurrentUser = account.id === currentUserId;
            const isPendingInvite = account.activationPending;
            return (
              <button
                key={account.id}
                type="button"
                className="maintenance-item account-access-item"
                onClick={() => onSelectAccount(account)}
                disabled={isCurrentUser || isPendingInvite}
              >
                <span className="maintenance-item-title">
                  {account.linkedPersonName || account.name || account.email}
                </span>
                <span className="maintenance-item-meta">
                  {account.email}
                  {account.linkedPersonRole ? ` • ${account.linkedPersonRole}` : ''}
                  {isCurrentUser ? ' • current session' : ''}
                  {isPendingInvite ? ' • pending invite' : ''}
                </span>
                <span className="maintenance-item-meta">{getAccountAccessStatus(account)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="maintenance-empty">No user accounts are available for reset.</p>
      )}
    </section>
  );
}

export default function Dashboard({ onNavigate, onProjectClick, onPersonClick }) {
  const { user, permissions } = useAuth();
  const {
    activity,
    milestones,
    conceptNotes,
    events,
    projects,
    people,
    publications,
    getPerson,
    getProject,
    loading,
    refreshResources,
    resourceStatus,
  } = useData();
  const [searchParams] = useSearchParams();
  const [adminAccounts, setAdminAccounts] = useState([]);
  const [adminAccountsLoading, setAdminAccountsLoading] = useState(false);
  const [adminAccountsError, setAdminAccountsError] = useState('');
  const [selectedAccount, setSelectedAccount] = useState(null);

  const dashboardResourceKeys = ['activity', 'milestones', 'conceptNotes', 'events', 'publications', 'projects', 'people'];
  const linkedPerson = getLinkedPerson(permissions, getPerson);
  const maintenanceAccess = canAccessMaintenance(permissions, linkedPerson);
  const reviewAccess = canAccessProjectReview(permissions, linkedPerson);
  const currentView = maintenanceAccess && searchParams.get('view') === 'maintenance' ? 'maintenance' : 'overview';
  const adminMaintenanceAccess = Boolean(permissions?.isAdmin);

  const fetchAdminAccounts = useCallback(async () => {
    if (!adminMaintenanceAccess) return;
    setAdminAccountsLoading(true);
    setAdminAccountsError('');
    try {
      const response = await api.get('/admin/users');
      setAdminAccounts(response.data || []);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setAdminAccountsError(typeof detail === 'string' ? detail : 'User accounts could not be loaded.');
    } finally {
      setAdminAccountsLoading(false);
    }
  }, [adminMaintenanceAccess]);

  useEffect(() => {
    if (!adminMaintenanceAccess || currentView !== 'maintenance') return;
    fetchAdminAccounts();
  }, [adminMaintenanceAccess, currentView, fetchAdminAccounts]);

  const maintenanceSnapshot = useMemo(() => {
    if (!maintenanceAccess) return null;
    return getMaintenanceSnapshot({
      people,
      projects,
      milestones,
      conceptNotes,
      getPerson,
    });
  }, [conceptNotes, getPerson, maintenanceAccess, milestones, people, projects]);

  const maintenanceCards = useMemo(() => {
    if (!maintenanceSnapshot) return [];

    return [
      {
        key: 'profiles',
        title: 'Profiles to complete',
        description: 'Missing research summaries or contact details.',
        count: maintenanceSnapshot.profilesToComplete.length,
        empty: 'No profiles currently need completion.',
        items: maintenanceSnapshot.profilesToComplete.slice(0, 5).map((item) => ({
          id: item.person.id,
          title: item.person.name,
          meta: `Missing ${item.missingFields.join(', ')}${item.lastUpdated ? ` • updated ${formatDaysAgo(item.freshnessDays)}` : ' • no profile update yet'}`,
          onClick: () => onPersonClick?.(item.person.id),
        })),
      },
      {
        key: 'refresh',
        title: 'Projects to refresh',
        description: 'No recent published activity or no surfaced activity yet.',
        count: maintenanceSnapshot.projectsToRefresh.length,
        empty: 'No projects currently need a refresh pass.',
        items: maintenanceSnapshot.projectsToRefresh.slice(0, 5).map((item) => ({
          id: item.project.id,
          title: item.project.title,
          meta: item.lastActivity
            ? `${item.lastActivity.title} • updated ${formatDaysAgo(item.freshnessDays)}${item.lead ? ` • ${item.lead.name}` : ''}`
            : `No published activity yet${item.lead ? ` • ${item.lead.name}` : ''}`,
          onClick: () => onProjectClick(item.project.id),
        })),
      },
      {
        key: 'milestones',
        title: 'Projects without milestones',
        description: 'Projects that still need a visible next milestone.',
        count: maintenanceSnapshot.projectsWithoutMilestones.length,
        empty: 'All projects currently have at least one milestone.',
        items: maintenanceSnapshot.projectsWithoutMilestones.slice(0, 5).map((item) => ({
          id: item.project.id,
          title: item.project.title,
          meta: `${item.lead ? item.lead.name : 'Lead not assigned'}${item.lastActivity?.date ? ` • latest activity ${formatDate(item.lastActivity.date)}` : ''}`,
          onClick: () => onProjectClick(item.project.id),
        })),
      },
      {
        key: 'notes',
        title: 'Concept notes to steward',
        description: 'Active notes that need clearer next steps or are nearing the end of their active window.',
        count: maintenanceSnapshot.notesToFollowUp.length,
        empty: 'No active concept notes currently need stewardship.',
        items: maintenanceSnapshot.notesToFollowUp.slice(0, 5).map((item) => ({
          id: item.note.id,
          title: item.note.title,
          meta: [
            item.activeEndingSoon
              ? (item.daysUntilActiveEnds === 0 ? 'Active window ends today' : `Active window ends in ${item.daysUntilActiveEnds} days`)
              : (item.missingNextSteps ? 'No next steps recorded' : `Updated ${formatDaysAgo(item.freshnessDays)}`),
            item.contributorLabel,
          ].filter(Boolean).join(' • '),
          onClick: () => onNavigate('conceptnotes', { note: item.note.id }),
        })),
      },
    ];
  }, [maintenanceSnapshot, onNavigate, onPersonClick, onProjectClick]);

  const handleAccountResetComplete = useCallback((updatedAccount) => {
    if (!updatedAccount?.id) return;
    setAdminAccounts((current) => current.map((account) => (
      account.id === updatedAccount.id ? updatedAccount : account
    )));
  }, []);

  const updates = useMemo(
    () => activity
      .filter((item) => item.type === 'update')
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map((item) => ({
        key: `${item.projectId || 'project'}::${item.date}::${item.title}`,
        title: item.title,
        meta: getProjectShortName(item.project),
        metaSecondary: item.date ? formatDate(item.date) : '',
        onClick: item.projectId ? () => onProjectClick(item.projectId) : null,
      })),
    [activity, onProjectClick]
  );

  const upcomingMilestones = useMemo(
    () => milestones
      .filter((milestone) => milestone.computedStatus !== 'completed' && milestone.computedStatus !== 'overdue')
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
      .map((milestone) => {
        const project = milestone.project ? getProject(milestone.project) : null;
        return {
          key: milestone.id,
          title: milestone.title,
          meta: project ? getProjectShortName(project.title) : '',
          metaSecondary: milestone.dueDate ? formatDate(milestone.dueDate) : '',
          onClick: milestone.project ? () => onProjectClick(milestone.project) : null,
          iconNode: <span className="milestone-status-symbol is-open dash-stream-milestone-symbol" />,
        };
      }),
    [getProject, milestones, onProjectClick]
  );

  const currentChallenges = useMemo(() => {
    const severityRank = { blocking: 0, slowing: 1 };

    return projects
      .map((project) => {
        const visibleChallenges = (project.currentChallenges || [])
          .filter((challenge) => challenge?.published !== false)
          .map((challenge) => ({
            ...challenge,
            severity: challenge.severity === 'minor' ? 'slowing' : challenge.severity,
          }))
          .sort((a, b) => {
            const severityDiff = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
            if (severityDiff !== 0) return severityDiff;
            return (b.lastModified || b.date || '').localeCompare(a.lastModified || a.date || '');
          });

        if (visibleChallenges.length === 0) return null;

        const primaryChallenge = visibleChallenges[0];
        const primaryDate = primaryChallenge.lastModified || primaryChallenge.date || '';
        const severityLabel = primaryChallenge.severity === 'blocking' ? 'Blocking' : 'Slowing';

        return {
          key: project.id,
          title: getProjectShortName(project.title),
          meta: visibleChallenges.length === 1 ? `${severityLabel} challenge` : `${visibleChallenges.length} active challenges`,
          metaSecondary: primaryDate
            ? `${primaryChallenge.description} • ${formatDate(primaryDate)}`
            : primaryChallenge.description,
          severity: primaryChallenge.severity,
          sortDate: primaryDate,
          onClick: () => onProjectClick(project.id),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const severityDiff = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
        if (severityDiff !== 0) return severityDiff;
        return (b.sortDate || '').localeCompare(a.sortDate || '');
      });
  }, [onProjectClick, projects]);

  const recentConceptNotes = useMemo(
    () => conceptNotes
      .filter((note) => isWithinLastMonths(getConceptNoteSortDate(note), 3))
      .sort((a, b) => getConceptNoteSortDate(b).localeCompare(getConceptNoteSortDate(a)))
      .map((note) => {
        const contributorLabel = getConceptNoteContributorLabel(note, getPerson);
        const latestSignals = [...(note.progressSignals || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const latestSignal = latestSignals[0] || null;
        const frontstageState = getConceptNoteFrontstageState(note);
        const progressSummary = latestSignal ? getConceptNoteProgressSummary(latestSignal, getProject) : null;
        return {
          key: note.id,
          title: note.title,
          meta: contributorLabel,
          metaSecondary: frontstageState === 'progressed'
            ? progressSummary?.label || 'Progressed'
            : reviewAccess && note.activeUntil
              ? `Active until ${formatDate(note.activeUntil)}`
              : '',
          onClick: () => onNavigate('conceptnotes', { note: note.id }),
        };
      }),
    [conceptNotes, getPerson, getProject, onNavigate, reviewAccess]
  );

  const recentPublications = useMemo(
    () => publications
      .filter((publication) => isWithinLastMonths(publication.date, 3))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map((publication, index) => ({
        key: `${publication.title}::${publication.date || index}`,
        title: publication.title,
        meta: publication.venue || '',
        metaSecondary: publication.date ? formatDate(publication.date) : '',
        onClick: () => onNavigate('publications'),
      })),
    [onNavigate, publications]
  );

  const upcomingEvents = useMemo(
    () => events
      .filter((event) => event.status === 'upcoming')
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map((event) => ({
        key: event.id,
        title: event.name,
        meta: event.location || '',
        metaSecondary: event.date ? formatDate(event.date) : '',
        onClick: () => onNavigate('events', { event: event.id }),
      })),
    [events, onNavigate]
  );

  const overviewHasData = (
    updates.length > 0
    || upcomingMilestones.length > 0
    || currentChallenges.length > 0
    || recentConceptNotes.length > 0
    || recentPublications.length > 0
    || upcomingEvents.length > 0
  );

  const hasAnyDashboardData = (
    projects.length > 0
    || people.length > 0
    || activity.length > 0
    || milestones.length > 0
    || conceptNotes.length > 0
    || events.length > 0
    || publications.length > 0
  );

  const failedDashboardResource = dashboardResourceKeys.find((key) => resourceStatus[key]?.status === 'error');

  if (loading && !hasAnyDashboardData) {
    return <SectionSkeleton cards={6} />;
  }

  if (!hasAnyDashboardData && failedDashboardResource) {
    return (
      <SectionNotice
        title="Dashboard data is unavailable"
        message={resourceStatus[failedDashboardResource]?.error || 'The dashboard could not be loaded right now.'}
        onRetry={() => refreshResources(dashboardResourceKeys)}
      />
    );
  }

  return (
    <section data-testid="dashboard-section" className="section active">
      {maintenanceAccess && (
        <div className="section-controls dashboard-view-controls">
          <div className="view-toggle">
            <button
              type="button"
              className={`filter-btn ${currentView === 'overview' ? 'active' : ''}`}
              onClick={() => onNavigate('dashboard')}
            >
              Overview
            </button>
            <button
              type="button"
              className={`filter-btn ${currentView === 'maintenance' ? 'active' : ''}`}
              onClick={() => onNavigate('dashboard', { view: 'maintenance' })}
            >
              Maintenance
            </button>
          </div>
        </div>
      )}

      {currentView === 'maintenance' ? (
        <div className="dash-maintenance-shell">
          <div className="dash-maintenance-intro">
            <p>Keep profiles, access, projects, and concept notes quietly up to date without turning the shared dashboard into a review queue.</p>
          </div>
          <div className="dash-maintenance-grid">
            {adminMaintenanceAccess && (
              <AccountAccessCard
                accounts={adminAccounts}
                currentUserId={user?.id}
                loading={adminAccountsLoading}
                error={adminAccountsError}
                onRetry={fetchAdminAccounts}
                onSelectAccount={setSelectedAccount}
              />
            )}
            {maintenanceCards.map((card) => (
              <section key={card.key} className="maintenance-card">
                <div className="maintenance-card-header">
                  <div>
                    <h4>{card.title}</h4>
                    <p>{card.description}</p>
                  </div>
                  <span className="maintenance-count">{card.count}</span>
                </div>
                {card.items.length > 0 ? (
                  <div className="maintenance-item-list">
                    {card.items.map((item) => (
                      <button key={item.id} type="button" className="maintenance-item" onClick={item.onClick}>
                        <span className="maintenance-item-title">{item.title}</span>
                        <span className="maintenance-item-meta">{item.meta}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="maintenance-empty">{card.empty}</p>
                )}
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="dashboard-gallery">
          <div className="dashboard-gallery-row">
            <DashboardStreamCard
              title="Updates"
              items={updates}
              emptyText="No published updates yet."
              icon={FileText}
              tone="updates"
            />
            <DashboardStreamCard
              title="Upcoming milestones"
              items={upcomingMilestones}
              emptyText="No upcoming milestones right now."
              icon={Flag}
              tone="milestones"
            />
            <DashboardStreamCard
              title="Challenges"
              items={currentChallenges}
              emptyText="No active challenges right now."
              icon={Compass}
              tone="challenges"
            />
          </div>

          <div className="dashboard-gallery-row">
            <DashboardStreamCard
              title="Events"
              items={upcomingEvents}
              emptyText="No upcoming events scheduled."
              icon={Calendar}
              tone="events"
            />
            <DashboardStreamCard
              title="Concept Notes"
              items={recentConceptNotes}
              emptyText="No active or recently progressed concept notes."
              icon={Lightbulb}
              tone="concept"
            />
            <DashboardStreamCard
              title="Publications"
              items={recentPublications}
              emptyText="No publications in the last 3 months."
              icon={BookOpen}
              tone="publication"
            />
          </div>

          {!overviewHasData && (
            <p className="dash-stream-page-empty">No dashboard items are available yet.</p>
          )}
        </div>
      )}

      {selectedAccount && (
        <PasswordResetModal
          account={selectedAccount}
          onClose={() => setSelectedAccount(null)}
          onResetComplete={handleAccountResetComplete}
        />
      )}
    </section>
  );
}
