# Yard Design Intent v0.1

Yard is a calm shared context and coordination layer for research programmes. It should help people understand what is happening, where support may be useful, and how work fits together between meetings.

Yard is not a monitoring system, reporting dashboard, productivity tracker, ranking tool, or performance-management surface.

This file is written primarily for AI-assisted coding sessions and secondarily for human contributors. It records design intent, not every implementation detail.

## Sources Of Truth

- `DESIGN.md` owns product/design intent.
- `frontend/src/App.css` owns Yard-specific implementation tokens, class behavior, spacing, colors, shadows, and responsive details.
- `frontend/src/index.css`, `frontend/tailwind.config.js`, and `frontend/src/components/ui/` provide generic Tailwind/shadcn infrastructure unless a Yard app surface explicitly uses them.
- Private product notes may inform future decisions, but they are not required for ordinary frontend implementation and should not be read unless explicitly authorized.

If this file and `App.css` disagree, follow the current implementation for the immediate change and flag the discrepancy. Do not silently invent a third pattern.

## Product Tone

Yard should feel:

- calm, restrained, and work-focused
- supportive rather than supervisory
- contextual rather than metric-heavy
- useful for coordination without creating a review queue
- clear enough for repeated use by busy researchers and programme staff

Prefer language such as shared context, programme attention, support, follow-up, guidance, visibility, project history, and project team.

Avoid language that implies surveillance, scoring, compliance, productivity measurement, ranking, performance review, or formal reporting unless the product explicitly introduces that mode.

## Surface Rules

### Dashboard

The dashboard is a focused awareness surface for recent context, shared attention, and light programme awareness. It should use a centered, scannable column of capped stream previews rather than a broad control-panel layout.

Dashboard previews may link to fuller context surfaces such as Project Context, Events, Concept Notes, and Publications. They should not become managerial reports, review queues, personal task lists, or productivity feeds.

Maintenance/admin dashboard areas should stay operational and quiet.

### Projects Catalogue

The projects catalogue is a broad browse/workspace surface. It should support scanning, filtering, and moving into detail pages. Do not constrain it like a reading page.

### Project Detail

Project detail pages are focused reading/detail surfaces. They should prioritize the project record, updates, milestones, challenges, feedback, team, and supporting context without stretching cards across very wide screens.

### Review

Review surfaces are coordination tools. They help identify where projects may benefit from support, follow-up, or attention.

Do not make Review feel like an audit queue, reporting dashboard, scorecard, or compliance tool. Internal ordering logic may prioritize projects, but UI language should not describe people or projects as ranked.

### Activity Feed

Activity Feed is for shared context about recent movement. It should not become a productivity feed or accountability log.

### People

People surfaces are for expertise discovery, collaborators, equipment, institutions, and shared topics. They must not rank people or imply personal performance assessment.

Profile completeness cues are acceptable in maintenance/admin contexts when framed as quiet upkeep, not public judgement.

### Resources And Onboarding

Resources and Onboarding are focused guidance surfaces. They may explain Yard's operating model more directly than the app UI, but should still stay concise.

### Modals, Panels, And Writing Flows

Creation and editing flows should be contained, predictable, and calm. Avoid turning writing modals into complex dashboards.

Use wording that makes visibility and attention consequences clear, especially around Save quietly, Publish, feedback, and review access.

## Canonical Patterns

### Buttons And Actions

- `filter-btn`: canonical for view, mode, and filter switching.
- `action-btn`: canonical for section-level primary actions.
- `action-btn small`: canonical for compact section actions.
- `action-btn secondary`: contextual secondary action style, especially in panels or detail contexts.
- `save-mode-btn quiet`: canonical for saving without resurfacing an item.
- `save-mode-btn publish`: canonical for publishing or resurfacing into shared programme attention.
- `save-mode-btn tertiary`: canonical for cancel/back/low-emphasis actions in writing flows.
- `entry-edit-btn`: canonical for low-prominence inline edit, complete, reopen, or similar row actions.
- `btn primary-btn` and `btn secondary-btn`: contextual for existing account/admin/modal flows. Do not use them as the default for new app-wide actions without a design decision.

Do not invent a new button class unless the existing patterns clearly fail the use case.

Sidebar personal shortcuts may appear in the footer identity area when they help users orient to their own profile or directly linked projects. Keep them quiet, factual, and membership-based; they should not become a personal dashboard, task list, or productivity surface.

### Surfaces

Reuse the existing surface family before adding new card types:

- dashboard stream cards in a focused awareness column for recent context
- maintenance cards for quiet operational upkeep
- project rows/cards for catalogue browsing
- project full-page sections for project records
- review rows/cards for coordination and follow-up
- people matrix/cards for discovery
- static cards for guidance pages
- modal and slide-out panels for contained editing/detail flows

Avoid nested cards unless the content genuinely needs a framed repeated item inside a larger tool.

### Layout Width

Do not globally constrain `.cg-content-inner`.

Use broad layouts for workspace surfaces such as Projects catalogue, Review scan/timeline-style views, People grids, Concept Notes, Events, and Publications.

Use focused widths for reading/detail surfaces where wide cards distort the experience, such as project detail pages and static Resources/Onboarding content.

Use focused widths for focused awareness surfaces where broad cards make scanning harder. Dashboard Overview uses the same 840px focused width as project detail pages, while Dashboard Maintenance may keep broader operational width.

Slide-out panels and modals should keep their own contextual width rules.

### Writing And Media

`LatexTextarea` and `LatexContent` are the current writing/rendering primitives. Supporting visuals should stay associated with the relevant update or project content.

If inline image insertion, image sizing, or image-row controls are present in the active branch, keep them simple and author-friendly. The user-facing model should be upload, caption, insert, size/layout when needed. Markdown details should not be required from ordinary users.

### Empty, Loading, And Feedback States

Empty states should explain what belongs in the surface without implying failure. Loading and refresh states should be quiet. Attention states should invite support or follow-up, not blame.

## Trust-Sensitive Rules

- Save quietly means the item is stored without bringing it back into shared programme attention.
- Publish means the item should resurface into shared programme attention.
- Feedback should remain contextual and visibility-aware.
- Challenges should be framed as coordination/support signals, not failures.
- Export/download is for portability and stewardship, not reporting; project exports must reuse the same live visibility and feedback-redaction rules as the app.
- Save quietly does not mean do not export; quiet content visible on a project page may appear in a project record export.
- Needs attention should be used carefully and should point toward useful support.
- Delayed and complete are acceptable for project work/milestones, but should not expand into productivity tracking.
- Programme support is safer than reviewer/review queue language where the user-facing meaning is support and coordination.

## Accessibility Baseline For New Work

Do not claim full accessibility compliance based on this file. For new or changed UI:

- icon-only buttons need accessible names
- form fields need labels or equivalent accessible names
- validation should be useful and connected to the relevant field
- modals and panels need dialog semantics and predictable close behavior
- keyboard focus must remain visible
- interactive controls must be keyboard reachable
- color must not be the only status indicator
- hover-only actions must also appear on focus or remain otherwise discoverable

## AI-Agent Rules

Before frontend edits, read this file and inspect the relevant existing components and CSS.

Prefer Yard's existing custom patterns over generic shadcn/Tailwind defaults unless the product fit is clear.

Do not add broad visual refactors while making a narrow feature change.

Do not add large explanatory text blocks inside the app to compensate for unclear UI. Improve the interaction or put durable explanation in Resources/Onboarding.

Flag trust-sensitive wording when a change could make Yard feel like monitoring, reporting, ranking, or performance management.

Do not widen Dashboard Overview back to the broad workspace width without an explicit product decision; it is intentionally focused.

## Maintenance Rule

Update this file in the same PR or commit whenever a frontend change:

- introduces a new visual pattern
- retires or replaces an existing pattern
- changes the meaning of a button, status, card, review state, or visibility control
- changes width/layout rules for a major surface
- changes trust-sensitive language around Review, Feedback, People, Activity, Challenges, Publish, or Save quietly

Small implementation-only CSS adjustments do not require a `DESIGN.md` update unless they change product meaning or establish a reusable pattern.

## Open Decisions

- Decide whether `btn primary-btn` and `btn secondary-btn` remain canonical only for admin/account/modal flows or should be retired over time.
- Decide the final focused-width rules for project detail and static guidance pages on the active branch.
- Decide whether Review Activity Feed and People Overview need explicit max-width constraints or should remain broad workspace surfaces.
- Review wording such as review queue, ordered, ranked, needs attention, and profile completeness before making them more prominent.
- Decide where future agent adoption instructions should live: `AGENTS.md`, README, a coding prompt template, or more than one of these.
