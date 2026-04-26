import React, { useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { Menu } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider, useData } from './contexts/DataContext';
import { ToastProvider } from './contexts/ToastContext';
import LoginPage from './pages/LoginPage';
import ActivateAccountPage from './pages/ActivateAccountPage';
import ForcePasswordChangePage from './pages/ForcePasswordChangePage';
import Sidebar from './components/app/Sidebar';
import Dashboard from './components/app/Dashboard';
import People from './components/app/People';
import Projects from './components/app/Projects';
import ProjectModal from './components/app/ProjectModal';
import ConceptNotePanel from './components/app/ConceptNotePanel';
import EventPanel from './components/app/EventPanel';
import ProjectFullPage from './components/app/ProjectFullPage';
import ProjectExportPrintPage from './components/app/ProjectExportPrintPage';
import PersonPanel from './components/app/PersonPanel';
import Publications from './components/app/Publications';
import Events from './components/app/Events';
import ConceptNotes from './components/app/ConceptNotes';
import Resources from './components/app/Resources';
import Onboarding from './components/app/Onboarding';
import { canAccessProjectContext } from './lib/projectReview';
import { getProjectTeamMemberIds } from './lib/projectTeam';
import { getLinkedPerson } from './lib/roleAccess';
import './App.css';

const sectionMeta = {
  dashboard: {
    label: 'Dashboard',
    title: 'Dashboard',
    path: '/dashboard',
    description: "See what’s happening across the programme.",
  },
  people: {
    label: 'People',
    title: 'People',
    path: '/people',
    description: "Find collaborators, expertise, and research strengths across institutions and roles.",
  },
  projects: {
    label: 'Projects',
    title: 'Projects',
    path: '/projects',
    description: 'Browse active projects, teams, and shared research records across the programme.',
  },
  review: {
    label: 'Project Context',
    title: 'Project Context',
    path: '/review',
    description: 'See recent project movement, milestones, and visible coordination signals.',
  },
  conceptnotes: {
    label: 'Concept Notes',
    title: 'Concept Notes',
    path: '/concept-notes',
    description: 'Keep promising early directions in view across the programme.',
  },
  events: {
    label: 'Events',
    title: 'Events',
    path: '/events',
    description: 'See upcoming programme events and meetings.',
  },
  publications: {
    label: 'Publications',
    title: 'Publications',
    path: '/publications',
    description: 'See publications linked to the programme and the latest work coming out of it.',
  },
  resources: {
    label: 'Getting Started',
    title: 'Getting Started',
    path: '/resources',
    description: 'Find your bearings in the programme, its rhythm, and the main ways of working.',
  },
};

function LoadingScreen({ label = 'Loading...' }) {
  return <div className="cg-loading">{label}</div>;
}

function getSectionFromPath(pathname) {
  if (pathname.startsWith('/people')) return 'people';
  if (pathname.startsWith('/projects')) return 'projects';
  if (pathname.startsWith('/review') || pathname.startsWith('/milestones')) return 'review';
  if (pathname.startsWith('/concept-notes')) return 'conceptnotes';
  if (pathname.startsWith('/events')) return 'events';
  if (pathname.startsWith('/publications')) return 'publications';
  if (pathname.startsWith('/onboarding')) return 'resources';
  if (pathname.startsWith('/resources')) return 'resources';
  return 'dashboard';
}

function ProjectFullPageRoute({ onBack, onPersonClick }) {
  const { projectId } = useParams();
  return <ProjectFullPage projectId={projectId} onBack={onBack} onPersonClick={onPersonClick} />;
}

function AppShell() {
  const { user, permissions } = useAuth();
  const { error, fetchAll, refreshing, getPerson, projects } = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('cg-sidebar-collapsed') === 'true');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth <= 900 : false
  ));

  useEffect(() => {
    localStorage.setItem('cg-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {
      setIsMobile(window.innerWidth <= 900);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, location.search]);

  const linkedPerson = useMemo(
    () => getLinkedPerson(permissions, getPerson),
    [getPerson, permissions]
  );
  const projectContextAccess = useMemo(
    () => canAccessProjectContext(permissions),
    [permissions]
  );
  const myProjects = useMemo(() => {
    if (!linkedPerson?.id) return [];
    return projects.filter((project) => getProjectTeamMemberIds(project).includes(linkedPerson.id));
  }, [linkedPerson?.id, projects]);
  const activeSection = useMemo(() => getSectionFromPath(location.pathname), [location.pathname]);
  const isProjectDetailRoute = location.pathname.startsWith('/projects/');
  const personPanelId = searchParams.get('person');
  const projectModalId = !isProjectDetailRoute ? searchParams.get('project') : null;
  const notePanelId = searchParams.get('note');
  const eventPanelId = searchParams.get('event');
  const catalogueScrollSection = !isProjectDetailRoute && ['projects', 'conceptnotes', 'events', 'publications'].includes(activeSection);
  const projectWorkspaceMode = !isMobile && activeSection === 'projects' && Boolean(projectModalId) && !isProjectDetailRoute;
  const conceptWorkspaceMode = !isMobile && activeSection === 'conceptnotes' && Boolean(notePanelId);
  const eventWorkspaceMode = !isMobile && activeSection === 'events' && Boolean(eventPanelId);
  const globalConceptPanelOpen = Boolean(notePanelId) && activeSection !== 'conceptnotes';
  const globalEventPanelOpen = Boolean(eventPanelId) && activeSection !== 'events';
  const workspaceWithPanel = projectWorkspaceMode || conceptWorkspaceMode || eventWorkspaceMode;
  const effectiveSidebarCollapsed = isMobile ? false : (
    sidebarCollapsed
    || projectWorkspaceMode
    || conceptWorkspaceMode
    || eventWorkspaceMode
    || globalConceptPanelOpen
    || globalEventPanelOpen
  );
  const pageMeta = isProjectDetailRoute
    ? {
        title: 'Project',
        description: 'See how the project is moving, what needs guidance, and who’s involved.',
      }
    : sectionMeta[activeSection] || sectionMeta.dashboard;

  const updateSearchParam = (key, value) => {
    const nextParams = new URLSearchParams(searchParams);

    if (!value) {
      nextParams.delete(key);
    } else {
      nextParams.set(key, value);
    }

    setSearchParams(nextParams, { replace: true });
  };

  const handleNavigate = (section, options = {}) => {
    const nextPath = sectionMeta[section]?.path || sectionMeta.dashboard.path;
    setMobileNavOpen(false);
    const nextParams = new URLSearchParams();

    Object.entries(options || {}).forEach(([key, value]) => {
      if (value) {
        nextParams.set(key, value);
      }
    });

    navigate({
      pathname: nextPath,
      search: nextParams.toString() ? `?${nextParams.toString()}` : '',
    });
  };

  const handleProjectClick = (projectId) => {
    if (!isMobile) {
      setSidebarCollapsed(true);
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('person');
    nextParams.delete('note');
    nextParams.delete('event');
    nextParams.set('project', projectId);
    setSearchParams(nextParams, { replace: true });
  };

  const handleConceptNoteClick = (noteId) => {
    if (!isMobile) {
      setSidebarCollapsed(true);
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('person');
    nextParams.delete('project');
    nextParams.delete('event');
    nextParams.set('note', noteId);
    setSearchParams(nextParams, { replace: true });
  };

  const handleEventClick = (eventId) => {
    if (!isMobile) {
      setSidebarCollapsed(true);
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('person');
    nextParams.delete('project');
    nextParams.delete('note');
    nextParams.set('event', eventId);
    setSearchParams(nextParams, { replace: true });
  };

  const handleWorkspacePanelOpen = () => {
    if (!isMobile) {
      setSidebarCollapsed(true);
    }
  };

  const handleViewFullProject = (projectId) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('project');
    const query = nextParams.toString();
    navigate(`/projects/${projectId}${query ? `?${query}` : ''}`);
  };

  const handlePersonClick = (personId) => {
    const nextParams = new URLSearchParams(searchParams);
    if (!isProjectDetailRoute) {
      nextParams.delete('project');
    }
    nextParams.set('person', personId);
    setSearchParams(nextParams, { replace: true });
  };

  const handleCloseProjectModal = () => {
    updateSearchParam('project', null);
  };

  const handleCloseConceptNotePanel = () => {
    updateSearchParam('note', null);
  };

  const handleCloseEventPanel = () => {
    updateSearchParam('event', null);
  };

  const handleClosePersonPanel = () => {
    updateSearchParam('person', null);
  };

  const handleOpenMyProfile = () => {
    if (!linkedPerson?.id) return;
    handlePersonClick(linkedPerson.id);
  };

  const handleOpenMyProjects = () => {
    handleNavigate('projects', { view: 'mine' });
  };

  return (
    <div className="cg-app">
      <a href="#main-content" className="skip-nav">Skip to main content</a>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {refreshing ? 'Refreshing data...' : ''}
      </div>
      <div
        className={`cg-sidebar-overlay ${mobileNavOpen ? 'open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
      />
      <Sidebar
        activeSection={activeSection}
        onNavigate={handleNavigate}
        showReview={projectContextAccess}
        collapsed={effectiveSidebarCollapsed}
        mobile={isMobile}
        mobileOpen={mobileNavOpen}
        userEmail={user?.email || ''}
        linkedPerson={linkedPerson}
        myProjectsCount={myProjects.length}
        onOpenMyProfile={handleOpenMyProfile}
        onOpenMyProjects={handleOpenMyProjects}
        onToggle={() => {
          if (isMobile) {
            setMobileNavOpen(false);
            return;
          }
          setSidebarCollapsed((current) => !current);
        }}
      />
      <main className={`cg-main ${effectiveSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <header className="cg-header">
          <button
            type="button"
            className="mobile-nav-toggle"
            onClick={() => setMobileNavOpen((current) => !current)}
            aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          >
            <Menu size={20} />
          </button>
          <div className="cg-header-copy">
            <h2 data-testid="section-title">{pageMeta.title}</h2>
            <p className="cg-header-description">{pageMeta.description}</p>
          </div>
          <div className="cg-header-meta">
            {refreshing && <span className="header-pill">Refreshing data...</span>}
            {error && <span className="header-pill warning">Partial data</span>}
            {error && (
              <button type="button" className="header-pill header-pill-action" onClick={() => fetchAll()}>
                Retry sync
              </button>
            )}
          </div>
        </header>

        <div className={`cg-content ${catalogueScrollSection ? 'catalogue-page-shell' : ''}`} id="main-content">
          <div className={`cg-content-inner ${catalogueScrollSection ? 'catalogue-page-shell' : ''} ${workspaceWithPanel ? 'workspace-with-panel' : ''} ${projectWorkspaceMode ? 'projects-panel-open' : ''} ${conceptWorkspaceMode ? 'conceptnotes-panel-open' : ''} ${eventWorkspaceMode ? 'events-panel-open' : ''}`}>
            {error && <div className="cg-alert-banner">{error}</div>}

            <Routes>
              <Route
                path="/dashboard"
                element={
                  <Dashboard
                    onNavigate={handleNavigate}
                    onProjectClick={handleProjectClick}
                    onNoteClick={handleConceptNoteClick}
                    onEventClick={handleEventClick}
                    onPersonClick={handlePersonClick}
                  />
                }
              />
              <Route path="/people" element={<People onPersonClick={handlePersonClick} />} />
              <Route
                path="/projects"
                element={
                  <Projects
                    mode="catalogue"
                    onProjectClick={handleProjectClick}
                    onNoteClick={handleConceptNoteClick}
                    onEventClick={handleEventClick}
                    onPersonClick={handlePersonClick}
                    onNavigate={handleNavigate}
                    panelOpen={!isMobile && Boolean(projectModalId)}
                  />
                }
              />
              <Route
                path="/projects/:projectId"
                element={<ProjectFullPageRoute onBack={() => navigate('/projects')} onPersonClick={handlePersonClick} />}
              />
              <Route
                path="/review"
                element={projectContextAccess
                  ? <Projects mode="review-only" onProjectClick={handleProjectClick} onNoteClick={handleConceptNoteClick} onEventClick={handleEventClick} onPersonClick={handlePersonClick} onNavigate={handleNavigate} />
                  : <Navigate to="/projects" replace />}
              />
              <Route path="/publications" element={<Publications />} />
              <Route path="/events" element={<Events onPanelOpen={handleWorkspacePanelOpen} />} />
              <Route path="/milestones" element={<Navigate to={projectContextAccess ? '/review' : '/projects'} replace />} />
              <Route path="/concept-notes" element={<ConceptNotes onPanelOpen={handleWorkspacePanelOpen} />} />
              <Route path="/resources" element={<Resources />} />
              <Route path="/rri" element={<Navigate to="/resources" replace />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </main>

      {projectModalId && (
        <ProjectModal
          projectId={projectModalId}
          onClose={handleCloseProjectModal}
          onViewFull={handleViewFullProject}
          onPersonClick={handlePersonClick}
        />
      )}

      {personPanelId && (
        <PersonPanel
          personId={personPanelId}
          onClose={handleClosePersonPanel}
          onProjectClick={handleViewFullProject}
        />
      )}

      {globalConceptPanelOpen && (
        <ConceptNotePanel
          noteId={notePanelId}
          onClose={handleCloseConceptNotePanel}
          onNoteClick={handleConceptNoteClick}
        />
      )}

      {globalEventPanelOpen && (
        <EventPanel
          eventId={eventPanelId}
          onClose={handleCloseEventPanel}
        />
      )}
    </div>
  );
}

function MainApp() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label="Checking session..." />;

  if (!user) {
    const next = `${location.pathname}${location.search || ''}`;
    const search = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
    return <Navigate to={`/login${search}`} replace />;
  }

  if (user.mustChangePassword) {
    const next = `${location.pathname}${location.search || ''}`;
    const search = next && next !== '/set-password' ? `?next=${encodeURIComponent(next)}` : '';
    return <Navigate to={`/set-password${search}`} replace />;
  }

  return (
    <Routes>
      <Route path="/projects/:projectId/export/print" element={<ProjectExportPrintPage />} />
      <Route
        path="/*"
        element={(
          <DataProvider>
            <AppShell />
          </DataProvider>
        )}
      />
    </Routes>
  );
}

function LoginPageWrapper() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label="Loading sign-in..." />;

  if (user) {
    const next = new URLSearchParams(location.search).get('next') || '/dashboard';
    if (user.mustChangePassword) {
      const search = next && next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : '';
      return <Navigate to={`/set-password${search}`} replace />;
    }
    return <Navigate to={next} replace />;
  }

  return <LoginPage />;
}

function ForcePasswordChangeWrapper() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label="Loading password reset..." />;

  if (!user) {
    const next = `${location.pathname}${location.search || ''}`;
    const search = next ? `?next=${encodeURIComponent(next)}` : '';
    return <Navigate to={`/login${search}`} replace />;
  }

  if (!user.mustChangePassword) {
    const next = new URLSearchParams(location.search).get('next') || '/dashboard';
    return <Navigate to={next === '/set-password' ? '/dashboard' : next} replace />;
  }

  return <ForcePasswordChangePage />;
}

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPageWrapper />} />
            <Route path="/activate" element={<ActivateAccountPage />} />
            <Route path="/set-password" element={<ForcePasswordChangeWrapper />} />
            <Route path="/*" element={<MainApp />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
