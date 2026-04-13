import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PROGRAMME_RHYTHM } from '../../lib/programmeRhythm';

const PROGRAMME_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'rri', label: 'Responsible Research' },
];

const RHYTHM_GROUPS = [
  { id: 'monthly', label: 'Monthly', cadence: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly', cadence: 'Quarterly' },
  { id: 'specialist', label: 'Twice yearly', cadence: 'Twice yearly' },
  { id: 'annual', label: 'Annual', cadence: 'Annual' },
];

export default function Resources({ initialTab = 'overview' }) {
  const [activeTab, setActiveTab] = useState(() => (
    PROGRAMME_TABS.some((tab) => tab.id === initialTab) ? initialTab : 'overview'
  ));

  return (
    <section data-testid="resources-section" className="section active">
      <div className="section-controls resource-controls">
        <div className="view-toggle resource-tab-toggle">
          {PROGRAMME_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`filter-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
          ))}
        </div>
      </div>
      {activeTab === 'overview' && <Overview />}
      {activeTab === 'rhythm' && <RhythmGuide />}
      {activeTab === 'rri' && <RRI />}
    </section>
  );
}

function Overview() {
  return (
    <div className="static-content">
      <OnboardingGuideCard />
      <WorkflowCatalogue />
    </div>
  );
}

function OnboardingGuideCard() {
  return (
    <div className="static-card resource-onboarding-card">
      <h3>Onboarding and Profiles</h3>
      <p>Yard is designed so people can get set up once, then make light-touch profile updates only when something material changes.</p>

      <div className="resource-onboarding-grid">
        <div className="resource-onboarding-column">
          <h4>For admins</h4>
          <div className="resource-onboarding-steps">
            <div className="resource-onboarding-step">
              <strong>1. Create the member in People.</strong>
              <p>Use <Link to="/people">People</Link> → <span>Onboard Member</span> to create the profile and the Yard login together.</p>
            </div>
            <div className="resource-onboarding-step">
              <strong>2. Share the invite link directly.</strong>
              <p>Yard shows the invite link once. The researcher uses it to choose their own password before the first sign-in.</p>
            </div>
            <div className="resource-onboarding-step">
              <strong>3. Reset access later from Maintenance if needed.</strong>
              <p>Use Dashboard → Maintenance → Account access when someone needs a fresh temporary password.</p>
            </div>
          </div>
        </div>

        <div className="resource-onboarding-column">
          <h4>For researchers</h4>
          <div className="resource-onboarding-steps">
            <div className="resource-onboarding-step">
              <strong>1. Open the invite and choose your password.</strong>
              <p>That activates your Yard login. After that, you sign in normally with your email and password.</p>
            </div>
            <div className="resource-onboarding-step">
              <strong>2. Open your profile from People and choose Edit Profile.</strong>
              <p>That is the main place for title, contact details, research interests, visibility, and optional links like ORCID, website, GitHub, or Substack.</p>
            </div>
            <div className="resource-onboarding-step">
              <strong>3. Add shared expertise or equipment support only if it helps others find you.</strong>
              <p>Keep it light. A few things you would be happy to be contacted about are enough.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RhythmGuide() {
  return (
    <div className="static-content">
      <ProgrammeRhythmCard />
      <KeyContactCard
        title="Key Contact"
        contacts={[
          {
            label: 'Programme Manager',
            personId: 'nkechi',
            name: 'Nkechi Adeyemi',
            description: 'can help with cross-institution coordination, meetings, travel, purchasing, and other programme-level practical issues that do not belong in project feedback or one project alone.',
          },
        ]}
      />
    </div>
  );
}

function ProgrammeRhythmCard() {
  const groupedMoments = RHYTHM_GROUPS
    .map((group) => ({
      ...group,
      moments: PROGRAMME_RHYTHM.filter((moment) => moment.cadence === group.cadence),
    }))
    .filter((group) => group.moments.length > 0);

  return (
    <div className="static-card resource-rhythm-card">
        <h3>Programme Rhythm</h3>
        <p>
          The programme has a rhythm. Some moments bring people together in person; others are points where updates,
          challenges, and concept notes may inform wider discussion.
        </p>
      <div className="resource-rhythm-board">
        {groupedMoments.map((group) => (
          <div key={group.id} className="resource-rhythm-row">
            <div className="resource-rhythm-frequency">{group.label}</div>
            <div className="resource-rhythm-stack">
              {group.moments.map((moment) => {
                return (
                  <div key={moment.id} className={`resource-rhythm-entry ${moment.kind} ${moment.subtle ? 'subtle' : ''}`}>
                    <div className="resource-rhythm-entry-accent" aria-hidden="true" />
                    <div className="resource-rhythm-entry-body">
                      <div className="resource-rhythm-title">{moment.title}</div>
                      <p>{moment.note}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkflowCatalogue() {
  return (
    <div className="static-card resource-workflow-card">
      <p>This page shows the main workflows, grouped by role, and where each one lives in the app.</p>

      <div className="resource-workflow-sections">
        {WORKFLOW_SECTIONS.map((section) => (
          <div key={section.title} className="resource-workflow-section">
            <h4>{section.title}</h4>
            <div className="resource-workflow-list" aria-label={section.title}>
              {section.rows.map((row) => (
                <div key={`${section.title}-${row.workflow}`} className="resource-workflow-row">
                  <div className="resource-workflow-name">{row.workflow}</div>
                  <div className="resource-workflow-where" aria-label={row.whereAria || row.where}>
                    {row.whereAction ? (
                      <>
                        <span
                          className={`resource-workflow-where-prefix ${row.wherePrefixGhost ? 'is-ghost' : ''}`}
                          aria-hidden={row.wherePrefixGhost ? 'true' : undefined}
                        >
                          {row.wherePrefix}
                        </span>
                        <span className="resource-workflow-where-action">{row.whereAction}</span>
                      </>
                    ) : (
                      row.where
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyContactCard({ title = 'Key Contact', contacts }) {
  return (
    <div className="static-card resource-contact-card">
      <h4>{title}</h4>
      <div className="resource-contact-list">
        {contacts.map((contact) => (
          <div key={contact.personId} className="resource-contact-item">
            <div className="resource-contact-label">{contact.label}</div>
            <p>
              <Link className="resource-contact-link" to={`/people?person=${contact.personId}`}>{contact.name}</Link>
              {' '}{contact.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RRI() {
  return (
    <div className="static-content">
      <div className="resource-rri-intro">
        <h3>Responsible Research</h3>
        <p>
          Responsible research is part of everyday programme work. This page summarises the shared principles and
          expectations that shape project decisions, data handling, stakeholder involvement, and translation.
        </p>
      </div>

      <div className="resource-rri-section">
        <h4>What this means in practice</h4>
        <div className="resource-guidance-points">
          <div className="resource-guidance-point">
            <strong>Project records should stay honest and current.</strong>
            <p>Updates, milestones, and current challenges are there to support thoughtful attention, not to present only good news.</p>
          </div>
          <div className="resource-guidance-point">
            <strong>Early concerns and opportunities should surface early enough to be useful.</strong>
            <p>Concept notes, project feedback, and programme discussions should help promising ideas, risks, and ethical questions become visible while they can still shape the work well.</p>
          </div>
          <div className="resource-guidance-point">
            <strong>Support is available when research raises wider questions.</strong>
            <p>The RETO and Programme Manager can help when work touches coordination, external engagement, translation, IP, or other programme-level considerations.</p>
          </div>
        </div>
      </div>

      <KeyContactCard
        title="Key Contact"
        contacts={[
          {
            label: 'RETO',
            personId: 'amara_reto',
            name: 'Dr. Amara Osei',
            description: 'can help with responsible research translation, public engagement, exploitation questions, IP thinking, and the kinds of external or ethical conversations that may help an idea move forward well.',
          },
        ]}
      />

    </div>
  );
}

const WORKFLOW_SECTIONS = [
  {
    title: 'For Everyone (start here)',
    rows: [
      { workflow: "See what's happening across the programme", where: 'Dashboard' },
      { workflow: 'Learn how the programme year works', where: 'Getting Started → Rhythm' },
      { workflow: 'Understand the RRI framework', where: 'Getting Started → Responsible Research' },
      { workflow: 'Find people, expertise, and equipment across the programme', where: 'People' },
      { workflow: 'Maintain your own profile', where: 'People → Your profile → Edit Profile' },
      { workflow: 'See what projects are currently active', where: 'Projects' },
      { workflow: 'Browse recent publications from across the programme', where: 'Publications' },
      { workflow: 'Share or browse concept notes', where: 'Concept Notes' },
      { workflow: 'Check programme events, agendas, and details', where: 'Events' },
    ],
  },
  {
    title: 'For Lead Researchers',
    rows: [
      {
        workflow: 'Share a project update',
        wherePrefix: 'Projects → Project page',
        whereAction: '→ Add Update',
        whereAria: 'Projects → Project page → Add Update',
      },
      {
        workflow: 'Add a milestone',
        wherePrefix: 'Projects → Project page',
        whereAction: '→ Add Milestone',
        wherePrefixGhost: true,
        whereAria: 'Projects → Project page → Add Milestone',
      },
      {
        workflow: 'Share a challenge',
        wherePrefix: 'Projects → Project page',
        whereAction: '→ Add Challenge',
        wherePrefixGhost: true,
        whereAria: 'Projects → Project page → Add Challenge',
      },
    ],
  },
  {
    title: 'For Admins and Coordinators',
    rows: [
      { workflow: 'Onboard a new member and prepare their invite link', where: 'People → Onboard Member' },
      { workflow: 'Create or refresh an invite for an existing profile', where: 'People → Profile → Invite to Yard' },
      { workflow: 'Reset a password for an existing account', where: 'Dashboard → Maintenance → Account access' },
    ],
  },
  {
    title: 'For PIs and Review Roles',
    rows: [
      { workflow: 'Scan projects that may need guidance', where: 'Projects → Review' },
      {
        workflow: 'Leave feedback on a project',
        wherePrefix: 'Projects → Project page',
        whereAction: '→ Add Feedback',
        whereAria: 'Projects → Project page → Add Feedback',
      },
      { workflow: 'Steward active concept notes and record progress traces', where: 'Concept Notes' },
    ],
  },
];
