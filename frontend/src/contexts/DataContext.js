import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api';

const DataContext = createContext(null);
const resourceKeys = [
  'institutions',
  'people',
  'projects',
  'publications',
  'events',
  'milestones',
  'conceptNotes',
  'activity',
];

const createResourceStatusMap = () => (
  resourceKeys.reduce((accumulator, key) => {
    accumulator[key] = { status: 'idle', error: '' };
    return accumulator;
  }, {})
);

const getErrorMessage = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (error?.code === 'ECONNABORTED') return 'The request timed out.';
  if (error?.message === 'Network Error') return 'The service could not be reached.';
  if (error?.response?.status >= 500) return 'The server returned an unexpected error.';
  return 'Request failed';
};

export function DataProvider({ children }) {
  const [institutions, setInstitutions] = useState([]);
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [publications, setPublications] = useState([]);
  const [events, setEvents] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [conceptNotes, setConceptNotes] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const resourceStatusRef = useRef(createResourceStatusMap());
  const [resourceStatus, setResourceStatus] = useState(() => resourceStatusRef.current);
  const hasLoadedOnceRef = useRef(false);

  const resourceConfig = useMemo(() => ({
    institutions: { path: '/institutions', apply: setInstitutions, label: 'institutions' },
    people: { path: '/people', apply: setPeople, label: 'people' },
    projects: { path: '/projects', apply: setProjects, label: 'projects' },
    publications: { path: '/publications', apply: setPublications, label: 'publications' },
    events: { path: '/events', apply: setEvents, label: 'events' },
    milestones: { path: '/milestones', apply: setMilestones, label: 'milestones' },
    conceptNotes: { path: '/conceptnotes', apply: setConceptNotes, label: 'concept notes' },
    activity: { path: '/dashboard/activity', apply: setActivity, label: 'recent activity' },
  }), []);

  const buildGlobalError = useCallback((statusMap) => {
    const failedLabels = Object.entries(statusMap)
      .filter(([, value]) => value.status === 'error')
      .map(([key]) => resourceConfig[key]?.label || key);

    if (failedLabels.length === 0) {
      return '';
    }

    return `Some programme data could not be loaded: ${failedLabels.join(', ')}.`;
  }, [resourceConfig]);

  const commitResourceStatus = useCallback((nextStatus, syncGlobalError = true) => {
    resourceStatusRef.current = nextStatus;
    setResourceStatus(nextStatus);
    if (syncGlobalError) {
      setError(buildGlobalError(nextStatus));
    }
  }, [buildGlobalError]);

  const fetchAll = useCallback(async () => {
    const requests = Object.entries(resourceConfig).map(([key, config]) => ({
      key,
      request: api.get(config.path),
    }));

    try {
      if (hasLoadedOnceRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError('');
      const loadingStatus = { ...resourceStatusRef.current };
      requests.forEach(({ key }) => {
        loadingStatus[key] = { status: 'loading', error: '' };
      });
      commitResourceStatus(loadingStatus, false);
      const responses = await Promise.allSettled(requests.map(({ request }) => request));
      const nextStatus = { ...loadingStatus };
      let hadSuccess = false;

      responses.forEach((result, index) => {
        const { key } = requests[index];
        if (result.status !== 'fulfilled') {
          nextStatus[key] = { status: 'error', error: getErrorMessage(result.reason) };
          return;
        }

        const data = result.value.data;
        resourceConfig[key].apply(data);
        nextStatus[key] = { status: 'loaded', error: '' };
        hadSuccess = true;
      });

      commitResourceStatus(nextStatus);

      if (hadSuccess) {
        setLastSyncedAt(new Date().toISOString());
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError('The programme data could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      hasLoadedOnceRef.current = true;
    }
  }, [commitResourceStatus, resourceConfig]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const refreshResource = useCallback(async (key) => {
    const config = resourceConfig[key];
    if (!config) return;

    const loadingStatus = {
      ...resourceStatusRef.current,
      [key]: { status: 'loading', error: '' },
    };
    commitResourceStatus(loadingStatus, false);

    try {
      const response = await api.get(config.path);
      config.apply(response.data);
      commitResourceStatus({
        ...loadingStatus,
        [key]: { status: 'loaded', error: '' },
      });
      setLastSyncedAt(new Date().toISOString());
      return response.data;
    } catch (err) {
      const message = getErrorMessage(err);
      commitResourceStatus({
        ...loadingStatus,
        [key]: { status: 'error', error: message },
      });
      throw err;
    }
  }, [commitResourceStatus, resourceConfig]);

  const refreshResources = useCallback(async (keys) => {
    const validKeys = [...new Set(keys)].filter((key) => resourceConfig[key]);
    if (validKeys.length === 0) return [];

    const loadingStatus = { ...resourceStatusRef.current };
    validKeys.forEach((key) => {
      loadingStatus[key] = { status: 'loading', error: '' };
    });
    commitResourceStatus(loadingStatus, false);

    const responses = await Promise.allSettled(
      validKeys.map((key) => api.get(resourceConfig[key].path))
    );
    const nextStatus = { ...loadingStatus };
    let hadSuccess = false;

    responses.forEach((result, index) => {
      const key = validKeys[index];
      if (result.status !== 'fulfilled') {
        nextStatus[key] = { status: 'error', error: getErrorMessage(result.reason) };
        return;
      }

      resourceConfig[key].apply(result.value.data);
      nextStatus[key] = { status: 'loaded', error: '' };
      hadSuccess = true;
    });

    commitResourceStatus(nextStatus);

    if (hadSuccess) {
      setLastSyncedAt(new Date().toISOString());
    }

    return responses;
  }, [commitResourceStatus, resourceConfig]);

  const getInstitution = useCallback((id) => institutions.find(i => i.id === id), [institutions]);
  const getPerson = useCallback((id) => people.find(p => p.id === id), [people]);
  const getProject = useCallback((id) => projects.find(p => p.id === id), [projects]);
  const replaceProject = useCallback((updatedProject) => {
    if (!updatedProject?.id) return;
    setProjects((current) => {
      let found = false;
      const next = current.map((project) => {
        if (project.id !== updatedProject.id) return project;
        found = true;
        return updatedProject;
      });
      return found ? next : current;
    });
    setLastSyncedAt(new Date().toISOString());
  }, []);

  const refreshMilestones = () => refreshResource('milestones');
  const refreshConceptNotes = () => refreshResource('conceptNotes');
  const refreshProjects = () => refreshResource('projects');

  return (
    <DataContext.Provider value={{
      institutions, people, projects, publications, events, milestones, conceptNotes,
      activity, loading, refreshing, error, lastSyncedAt, resourceStatus,
      getInstitution, getPerson, getProject,
      refreshMilestones, refreshConceptNotes, refreshProjects, refreshResource, refreshResources, fetchAll,
      replaceProject
    }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
