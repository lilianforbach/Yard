import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../lib/constants';
import { getProjectContributorIds, getProjectLeadId } from '../../lib/projectTeam';
import LatexContent from './LatexContent';

function getSvgUrls(record) {
  if (Array.isArray(record?.svgUrls)) {
    return record.svgUrls.filter(Boolean);
  }
  if (record?.svgUrl) {
    return [record.svgUrl];
  }
  return [];
}

function getVisualFilename(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.origin);
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '') || url;
  } catch {
    return url.split('/').filter(Boolean).pop() || url;
  }
}

function getInlineVisualFilenames(content) {
  const filenames = new Set();
  const imagePattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match = imagePattern.exec(content || '');
  while (match) {
    const filename = getVisualFilename(match[1]);
    if (filename) filenames.add(filename);
    match = imagePattern.exec(content || '');
  }
  return filenames;
}

function getUninsertedSvgUrls(record) {
  const inlineFilenames = getInlineVisualFilenames(record?.content || '');
  return getSvgUrls(record).filter((url) => !inlineFilenames.has(getVisualFilename(url)));
}

function getFeedbackDisplayTitle(entry) {
  const title = (entry?.title || '').trim();
  if (title) return title;
  const excerpt = (entry?.content || '').replace(/\s+/g, ' ').trim();
  if (!excerpt) return 'Feedback';
  return excerpt.length > 88 ? `${excerpt.slice(0, 85).trim()}...` : excerpt;
}

function normalizeChallengeSeverity(value) {
  if (value === 'blocking') return 'Blocking';
  return 'Slowing';
}

function PrintVisualList({ urls = [], labelPrefix = 'Visual' }) {
  if (urls.length === 0) return null;
  return (
    <div className="project-export-visual-list">
      {urls.map((url, index) => (
        <figure className="project-export-visual" key={`${url}-${index}`}>
          <img src={url} alt={`${labelPrefix} ${index + 1}`} />
          <figcaption>{labelPrefix} {index + 1}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function ProjectExportPrintPage() {
  const { projectId } = useParams();
  const { user, permissions } = useAuth();
  const [state, setState] = useState({
    loading: true,
    error: '',
    project: null,
    milestones: [],
    people: [],
  });

  useEffect(() => {
    let cancelled = false;
    async function fetchExportData() {
      setState((current) => ({ ...current, loading: true, error: '' }));
      try {
        const [projectRes, milestonesRes, peopleRes] = await Promise.all([
          api.get(`/projects/${projectId}`),
          api.get('/milestones'),
          api.get('/people'),
        ]);
        if (cancelled) return;
        setState({
          loading: false,
          error: '',
          project: projectRes.data,
          milestones: milestonesRes.data,
          people: peopleRes.data,
        });
      } catch (err) {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: err?.response?.status === 404 ? 'Project not found.' : 'Could not load the project record.',
        }));
      }
    }
    fetchExportData();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const { project, milestones, people, loading, error } = state;
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people]
  );
  const lead = project ? peopleById.get(getProjectLeadId(project)) : null;
  const exportingPerson = permissions?.linkedPersonId ? peopleById.get(permissions.linkedPersonId) : null;
  const exportingUserLabel = exportingPerson?.name || user?.name || user?.email || 'you';
  const contributors = project
    ? getProjectContributorIds(project).map((id) => peopleById.get(id)).filter(Boolean)
    : [];
  const projectMilestones = useMemo(
    () => (milestones || [])
      .filter((milestone) => (milestone.project || milestone.projectId) === project?.id)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')),
    [milestones, project?.id]
  );
  const currentChallenges = useMemo(
    () => [...(project?.currentChallenges || [])]
      .sort((a, b) => ((b.lastModified || b.date || '').localeCompare(a.lastModified || a.date || ''))),
    [project?.currentChallenges]
  );
  const resolvedChallenges = useMemo(
    () => [...(project?.resolvedChallenges || [])]
      .sort((a, b) => ((b.resolvedDate || b.lastModified || b.date || '').localeCompare(a.resolvedDate || a.lastModified || a.date || ''))),
    [project?.resolvedChallenges]
  );
  const progressEntries = useMemo(
    () => [
      ...(project?.updates || []).map((entry) => ({ ...entry, entryType: 'updates' })),
      ...(project?.feedback || []).map((entry) => ({ ...entry, entryType: 'feedback' })),
    ].sort((a, b) => ((b.lastModified || b.date || '').localeCompare(a.lastModified || a.date || ''))),
    [project?.updates, project?.feedback]
  );
  const exportedAt = useMemo(
    () => new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date()),
    []
  );

  if (loading) {
    return <div className="project-export-print project-export-state">Preparing project record...</div>;
  }

  if (error || !project) {
    return (
      <div className="project-export-print project-export-state">
        <p>{error || 'Project not found.'}</p>
        <Link to="/projects" className="project-export-back-link"><ArrowLeft size={15} /> Back to Projects</Link>
      </div>
    );
  }

  const abstract = project.abstract || project.description || '';
  const renderProgressEntry = (entry, index) => {
    const visualUrls = entry.entryType === 'updates' ? getUninsertedSvgUrls(entry) : [];
    return (
      <div className="project-export-entry" key={`${entry.entryType}-${entry.id || index}`}>
        <h3>{entry.entryType === 'feedback' ? getFeedbackDisplayTitle(entry) : entry.title}</h3>
        <p className="project-export-entry-meta">
          {[
            entry.entryType === 'feedback' ? 'Feedback' : 'Update',
            formatDate(entry.lastModified || entry.date),
            entry.author,
          ].filter(Boolean).join(' • ')}
        </p>
        <LatexContent text={entry.content} className="project-export-prose" />
        {entry.entryType === 'updates' && entry.slidesUrl && (
          <p className="project-export-link-line">
            Slides: <a href={entry.slidesUrl}>{entry.slidesUrl}</a>
          </p>
        )}
        <PrintVisualList urls={visualUrls} labelPrefix="Supporting visual" />
      </div>
    );
  };

  return (
    <div className="project-export-print">
      <div className="project-export-actions">
        <Link to={`/projects/${project.id}`} className="project-export-back-link">
          <ArrowLeft size={15} /> Back to project
        </Link>
        <p className="project-export-print-hint">
          For a clean PDF, turn off browser headers and footers in the print dialog.
        </p>
        <button type="button" className="project-export-print-button" onClick={() => window.print()}>
          <Printer size={15} /> Print / Save as PDF
        </button>
      </div>

      <article className="project-export-document">
        <header className="project-export-header">
          <p className="project-export-kicker">Yard project record</p>
          <h1>{project.title}</h1>
          <p className="project-export-note">Snapshot of project content visible to {exportingUserLabel}. Exported {exportedAt}.</p>
        </header>

        <section className="project-export-meta-grid" aria-label="Project team">
          {lead && (
            <div>
              <span>Lead</span>
              <strong>{lead.name}</strong>
            </div>
          )}
          {contributors.length > 0 && (
            <div>
              <span>Contributors</span>
              <strong>{contributors.map((person) => person.name).join(', ')}</strong>
            </div>
          )}
        </section>

        {abstract && (
          <section className="project-export-section">
            <h2>Abstract</h2>
            <LatexContent text={abstract} className="project-export-prose" />
          </section>
        )}

        {(project.slidesUrl || getSvgUrls(project).length > 0) && (
          <section className="project-export-section">
            <h2>Presentation Slides And Visuals</h2>
            {project.slidesUrl && (
              <p className="project-export-link-line">
                Slides: <a href={project.slidesUrl}>{project.slidesUrl}</a>
              </p>
            )}
            <PrintVisualList urls={getSvgUrls(project)} labelPrefix="Project visual" />
          </section>
        )}

        {currentChallenges.length > 0 && (
          <section className="project-export-section">
            <h2>Current Challenges</h2>
            {currentChallenges.map((challenge, index) => (
              <div className="project-export-entry" key={challenge.id || index}>
                <h3>{normalizeChallengeSeverity(challenge.severity)}</h3>
                <p className="project-export-entry-meta">
                  {[formatDate(challenge.lastModified || challenge.date), challenge.raisedBy].filter(Boolean).join(' • ')}
                </p>
                <LatexContent text={challenge.description} className="project-export-prose" />
              </div>
            ))}
          </section>
        )}

        {resolvedChallenges.length > 0 && (
          <section className="project-export-section">
            <h2>Resolved Challenges</h2>
            {resolvedChallenges.map((challenge, index) => (
              <div className="project-export-entry" key={challenge.id || index}>
                <h3>{normalizeChallengeSeverity(challenge.severity)}</h3>
                <p className="project-export-entry-meta">
                  {[formatDate(challenge.resolvedDate || challenge.lastModified || challenge.date), challenge.resolvedBy].filter(Boolean).join(' • ')}
                </p>
                <LatexContent text={challenge.description} className="project-export-prose" />
                {challenge.resolutionNote && (
                  <LatexContent text={`Resolution: ${challenge.resolutionNote}`} className="project-export-prose" />
                )}
              </div>
            ))}
          </section>
        )}

        {projectMilestones.length > 0 && (
          <section className="project-export-section">
            <h2>Milestones</h2>
            <div className="project-export-list">
              {projectMilestones.map((milestone) => (
                <div className="project-export-list-row" key={milestone.id}>
                  <strong>{milestone.title}</strong>
                  <span>{formatDate(milestone.dueDate)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {progressEntries.length > 0 && (
          <section className="project-export-section project-export-progress-section">
            <div className="project-export-section-start">
              <h2>Progress</h2>
              {renderProgressEntry(progressEntries[0], 0)}
            </div>
            {progressEntries.slice(1).map((entry, index) => renderProgressEntry(entry, index + 1))}
          </section>
        )}
      </article>
    </div>
  );
}
