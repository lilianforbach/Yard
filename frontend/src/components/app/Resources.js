import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PROGRAMME_RHYTHM } from '../../lib/programmeRhythm';
import LatexContent from './LatexContent';

const PROGRAMME_TABS = [
  { id: 'guide', label: 'Guide' },
  { id: 'overview', label: 'Workflows' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'rri', label: 'Responsible Research' },
];

const YARD_GUIDE_MARKDOWN = `
# Yard Guide

_3 min read_

## What Yard is

Yard is a shared workspace for keeping research work in context between meetings. It helps members of a programme see what is moving, what may need support, and where their expertise might be useful.

It is designed for research-programme communities that need light-touch visibility across people, projects, and meetings. A good working average is around _10 minutes per month_ of active use -- time spent checking context, recording a few useful signals, and responding where relevant. That is time in Yard itself, not the research work it supports.

## About this demo

This is a seeded demo of Yard. It uses fictional personas and sample records to show the kinds of work, questions, and signals Yard can carry. The workflows are real.

The aim is not to learn every feature or read every page closely. It is to get a clear feel for what Yard is for, how it works, and where it might fit in a research programme.

## How Yard is meant to work

Yard is built to keep work visible across a programme without becoming a heavy process.

Project leads use Yard to keep the direction and current state of a project visible over time. They decide what is worth recording, how often to update, which milestones matter, and which challenges to signal. A project lead is the person carrying the project forward day to day. It is a working role, not a marker of seniority.

In that context, _Save quietly_ and _Publish_ are meaningful choices. _Save quietly_ keeps something on the project page as part of the ongoing record. _Publish_ gives it wider visibility in Yard, including on the Dashboard, when shared awareness, timely review, or broader expertise would help move the work forward.

Feedback works differently. It stays close to the project page and the work it relates to, rather than entering that wider layer of visibility.

For PIs and others in review roles, Yard offers a way to stay aware of the programme beyond the projects they know best, and to see where their judgement, experience, or connections may be useful -- whether that contribution happens in Yard, in meetings, or through direct conversations.

The programme generates many early ideas. Concept notes give them a visible place so they can create connections, inform discussion, link into project work, and be taken forward.

## A suggested way to explore

Different people will naturally look for different things.

### If you are a PI

A good starting path is:

- Open _Dashboard_ to get a quick sense of what is visible across the programme.
- Open _Review_ to see where projects may benefit from attention, follow-up, or wider support.
- Open a few projects outside your own immediate area and look at how updates, milestones, challenges, and feedback sit together on the page.
- Visit _People_ and _Events_ to see how expertise and programme activity are surfaced across the app.

As you explore, notice whether Yard helps you form a clear picture quickly, and whether it shows you where your perspective may be useful.

### If you are a researcher or project lead

A good starting path is:

- Open a project page and read one or two recent updates.
- Look at the project's milestones and current challenges.
- Compare what stays local to the project page with what becomes more visible across the wider programme.
- Visit _People_ to see how expertise is made discoverable, and open a _Concept Note_ to see how earlier-stage ideas can stay visible and useful.

As you explore, notice whether the project page feels like a helpful working surface, and whether it makes the shape and current state of the work easier to understand.

## What to look for

As you move through the demo, a few questions may be worth keeping in mind:

- Does a small amount of upkeep create a clearer picture of the programme than meetings and scattered updates alone?
- Do project pages make it easier to understand both the science and the current state of a project?
- Do milestones, challenges, and feedback feel like useful signals in context?
- Do concept notes help early ideas stay visible at the right stage?
- Does Yard help the programme make better use of the expertise it already has?
- Does the amount of platform use feel proportionate to the value of the shared picture it creates?

## What is available in this demo

This demo includes Yard's main shared surfaces: _Dashboard_, _People_, _Projects_, _Review_, _Concept Notes_, _Events_, _Publications_, and _Getting Started_.

What you can change depends on the persona you are using:

- PI accounts are mainly for exploring the wider programme, using _Review_, and contributing feedback where useful.
- Researcher and project-lead accounts are for exploring the wider programme and, where relevant, maintaining the records of the projects they lead.

## After your tour

Useful feedback can be simple. You might note what felt intuitive, what felt unclear, what you would trust, what you would ignore, and what would make Yard more useful in the real life of a programme.
`;

const RHYTHM_GROUPS = [
  { id: 'monthly', label: 'Monthly', cadence: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly', cadence: 'Quarterly' },
  { id: 'specialist', label: 'Twice yearly', cadence: 'Twice yearly' },
  { id: 'annual', label: 'Annual', cadence: 'Annual' },
];

export default function Resources({ initialTab = 'guide' }) {
  const [activeTab, setActiveTab] = useState(() => (
    PROGRAMME_TABS.some((tab) => tab.id === initialTab) ? initialTab : 'guide'
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
      {activeTab === 'guide' && <YardGuide />}
    </section>
  );
}

function Overview() {
  return (
    <div className="static-content">
      <WorkflowCatalogue />
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
      <div className="static-card resource-rri-hero">
        <h3>Responsible Research</h3>
        <p>
          Responsible research and innovation is part of how this programme works. It helps us think carefully about
          how research is done, how it may be used, who it may affect, and how wider questions can help shape the work well.
        </p>
      </div>

      <div className="static-card resource-rri-card">
        <h4>The EPSRC Framework</h4>
        <p className="resource-rri-lead">
          The programme follows the EPSRC framework for responsible innovation, using the <strong>AREA</strong> approach:
          {' '}Anticipate, Reflect, Engage, and Act.
        </p>

        <div className="resource-area-grid">
          <div className="resource-area-card">
            <div className="resource-area-letter">A</div>
            <div className="resource-area-body">
              <strong>Anticipate</strong>
              <p>Consider possible implications, opportunities, and wider effects.</p>
            </div>
          </div>
          <div className="resource-area-card">
            <div className="resource-area-letter">R</div>
            <div className="resource-area-body">
              <strong>Reflect</strong>
              <p>Examine assumptions, motivations, uncertainties, and framing.</p>
            </div>
          </div>
          <div className="resource-area-card">
            <div className="resource-area-letter">E</div>
            <div className="resource-area-body">
              <strong>Engage</strong>
              <p>Involve relevant people, perspectives, and stakeholders.</p>
            </div>
          </div>
          <div className="resource-area-card">
            <div className="resource-area-letter">A</div>
            <div className="resource-area-body">
              <strong>Act</strong>
              <p>Let what emerges inform decisions, direction, and practice.</p>
            </div>
          </div>
        </div>

        <p className="resource-rri-reference">
          See the{' '}
          <a
            href="https://www.ukri.org/who-we-are/epsrc/our-policies-and-standards/framework-for-responsible-innovation/"
            target="_blank"
            rel="noreferrer"
          >
            EPSRC framework for responsible innovation
          </a>.
        </p>
      </div>

      <div className="static-card resource-rri-card">
        <h4>What this means in the programme</h4>
        <div className="resource-guidance-points">
          <div className="resource-guidance-point">
            <strong>Think early about wider implications.</strong>
            <p>That may include societal, environmental, ethical, and cultural questions connected to the research.</p>
          </div>
          <div className="resource-guidance-point">
            <strong>Consider how work may be understood and used.</strong>
            <p>Methods, findings, tools, and examples can travel beyond the immediate project, so it is worth thinking about how they may be interpreted and applied.</p>
          </div>
          <div className="resource-guidance-point">
            <strong>Bring in the right perspectives when useful.</strong>
            <p>Questions around public engagement, framing, partnerships, translation, IP, or external use often benefit from wider expertise and discussion.</p>
          </div>
          <div className="resource-guidance-point">
            <strong>Let new insight shape the work.</strong>
            <p>Plans, claims, collaborations, and routes to application can all be refined as the work develops.</p>
          </div>
        </div>
        <div className="resource-rri-reflection">
          <p>
            Different projects will call for different kinds of RRI attention. Some questions are best worked through
            within a project. Others benefit from broader engagement across the programme or beyond it. The aim is
            thoughtful, proportionate, and constructive practice.
          </p>
          <p>
            RRI is part of the shared work of the programme. It helps ensure that the research is not only excellent in
            itself, but also well considered in how it develops, how it connects with others, and how it creates value
            more widely.
          </p>
        </div>
      </div>

      <KeyContactCard
        title="Key Contact"
        contacts={[
          {
            label: 'RETO',
            personId: 'callum',
            name: 'Dr. Callum Buchanan',
            description: 'can help with responsible innovation, translation, public engagement, partnerships, IP, and wider framing questions across the programme.',
          },
        ]}
      />
    </div>
  );
}

function YardGuide() {
  return (
    <div className="static-content">
      <div className="resource-guide-page">
        <LatexContent text={YARD_GUIDE_MARKDOWN} rawMarkdown className="resource-guide-markdown" />
      </div>
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
