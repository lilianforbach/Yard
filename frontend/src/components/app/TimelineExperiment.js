import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatDate } from '../../lib/constants';

const OVERLAY_LANES = [
  { direction: 'above', gap: '0.65rem' },
  { direction: 'below', gap: '0.65rem' },
  { direction: 'above', gap: '3rem' },
  { direction: 'below', gap: '3rem' },
];
const TOP_EDGE_LANES = [
  { direction: 'below', gap: '0.65rem' },
  { direction: 'below', gap: '3rem' },
  { direction: 'below', gap: '5.35rem' },
  { direction: 'above', gap: '0.65rem' },
  { direction: 'above', gap: '3rem' },
];
const BOTTOM_EDGE_LANES = [
  { direction: 'above', gap: '0.65rem' },
  { direction: 'above', gap: '3rem' },
  { direction: 'above', gap: '5.35rem' },
  { direction: 'below', gap: '0.65rem' },
  { direction: 'below', gap: '3rem' },
];
const MILESTONE_FOCUS_THRESHOLD_PX = 34;
const MILESTONE_MOUSE_PULL_LIMIT_PX = 14;
const LABEL_HORIZONTAL_BUFFER_PCT = 0.7;
const LABEL_VERTICAL_BUFFER_REM = 0.18;

function parseMilestoneDate(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getMilestoneLeftPct(dueDate, timelineWindow) {
  const parsed = parseMilestoneDate(dueDate);
  if (!parsed) return 0;
  const totalMs = Math.max(1, timelineWindow.end - timelineWindow.start);
  return ((parsed - timelineWindow.start) / totalMs) * 100;
}

function compareMilestonesByDate(a, b) {
  const aDate = parseMilestoneDate(a.dueDate);
  const bDate = parseMilestoneDate(b.dueDate);
  return aDate - bDate;
}

function getMilestoneLabelLayout(positionPct, previousPct, nextPct, title = '') {
  let alignClass = 'align-center';
  if (positionPct <= 11) alignClass = 'align-left';
  if (positionPct >= 89) alignClass = 'align-right';

  const crowdedLeft = previousPct != null && Math.abs(positionPct - previousPct) < 12;
  const crowdedRight = nextPct != null && Math.abs(nextPct - positionPct) < 12;
  const densityClass = crowdedLeft || crowdedRight || title.length > 34 ? 'is-compact' : '';

  return {
    alignClass,
    densityClass,
  };
}

function getMilestoneCardSpanPct(alignClass, densityClass) {
  const spanPct = densityClass === 'is-compact' ? 10.5 : 13.5;
  if (alignClass === 'align-left' || alignClass === 'align-right') {
    return { startOffset: 0, endOffset: spanPct };
  }
  return { startOffset: spanPct / 2, endOffset: spanPct / 2 };
}

function parseGapRem(value) {
  const parsed = Number.parseFloat(String(value).replace('rem', ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMilestoneCardHeightRem(densityClass, title = '') {
  if (densityClass === 'is-compact') return 4.75;
  if ((title || '').length > 26) return 4.35;
  return 3.8;
}

function buildCandidateLabelBox({ direction, gapRem, cardHeightRem, startPct, endPct }) {
  if (direction === 'above') {
    return {
      left: startPct,
      right: endPct,
      top: -(gapRem + cardHeightRem),
      bottom: -gapRem,
    };
  }

  return {
    left: startPct,
    right: endPct,
    top: gapRem,
    bottom: gapRem + cardHeightRem,
  };
}

function getBoxOverlapScore(a, b) {
  const horizontalOverlap = Math.max(
    0,
    Math.min(a.right, b.right) - Math.max(a.left, b.left) - LABEL_HORIZONTAL_BUFFER_PCT
  );
  const verticalOverlap = Math.max(
    0,
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) - LABEL_VERTICAL_BUFFER_REM
  );

  if (horizontalOverlap <= 0 || verticalOverlap <= 0) return 0;
  return horizontalOverlap * verticalOverlap;
}

function getOpenMilestonePriority(milestone) {
  switch (milestone.computedStatus) {
    case 'overdue':
      return 0;
    case 'approaching':
      return 1;
    default:
      return 2;
  }
}

function selectMilestonesForOverlay(milestones) {
  if (milestones.length <= 6) return milestones;

  const openMilestones = milestones
    .filter((milestone) => milestone.computedStatus !== 'completed')
    .sort((a, b) => {
      const priorityDiff = getOpenMilestonePriority(a) - getOpenMilestonePriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return parseMilestoneDate(a.dueDate) - parseMilestoneDate(b.dueDate);
    });
  const completedMilestones = milestones
    .filter((milestone) => milestone.computedStatus === 'completed')
    .sort((a, b) => parseMilestoneDate(b.dueDate) - parseMilestoneDate(a.dueDate));

  const maxLabels = milestones.length >= 9 ? 4 : 5;
  const chosenOpen = openMilestones.slice(0, Math.min(openMilestones.length, 4));
  const remainingSlots = Math.max(0, maxLabels - chosenOpen.length);
  const chosenCompleted = completedMilestones.slice(0, remainingSlots);
  const selectedIds = new Set([...chosenOpen, ...chosenCompleted].map((milestone) => milestone.id));

  return milestones.filter((milestone) => selectedIds.has(milestone.id));
}

function getOverlayMilestones(milestones, focusedMilestoneId) {
  const baseMilestones = selectMilestonesForOverlay(milestones);
  if (!focusedMilestoneId || baseMilestones.some((milestone) => milestone.id === focusedMilestoneId)) {
    return baseMilestones;
  }

  const focusedMilestone = milestones.find((milestone) => milestone.id === focusedMilestoneId);
  if (!focusedMilestone) return baseMilestones;

  return [...baseMilestones, focusedMilestone].sort(compareMilestonesByDate);
}

function getOverlayLanesForRow(rowIndex, rowCount) {
  if (rowCount > 0 && rowIndex >= rowCount - 3) {
    return BOTTOM_EDGE_LANES;
  }

  if (rowIndex <= 2) {
    return TOP_EDGE_LANES;
  }

  return OVERLAY_LANES;
}

function buildOverlayLayouts(milestones, timelineWindow, laneDefinitions = OVERLAY_LANES) {
  const placedBoxes = [];
  const layouts = new Map();
  const labelledMilestones = [...milestones].sort(compareMilestonesByDate);

  labelledMilestones.forEach((milestone, index) => {
    const milestoneLeft = getMilestoneLeftPct(milestone.dueDate, timelineWindow);
    const previousMilestoneLeft = index > 0
      ? getMilestoneLeftPct(labelledMilestones[index - 1].dueDate, timelineWindow)
      : null;
    const nextMilestoneLeft = index < labelledMilestones.length - 1
      ? getMilestoneLeftPct(labelledMilestones[index + 1].dueDate, timelineWindow)
      : null;
    const { alignClass, densityClass } = getMilestoneLabelLayout(
      milestoneLeft,
      previousMilestoneLeft,
      nextMilestoneLeft,
      milestone.title
    );
    const { startOffset, endOffset } = getMilestoneCardSpanPct(alignClass, densityClass);
    const startPct = alignClass === 'align-right'
      ? milestoneLeft - endOffset
      : milestoneLeft - startOffset;
    const endPct = alignClass === 'align-left'
      ? milestoneLeft + endOffset
      : milestoneLeft + startOffset;
    const cardHeightRem = getMilestoneCardHeightRem(densityClass, milestone.title);

    let laneIndex = 0;
    let bestLaneIndex = 0;
    let bestLaneScore = Infinity;

    for (let candidateIndex = 0; candidateIndex < laneDefinitions.length; candidateIndex += 1) {
      const candidateLane = laneDefinitions[candidateIndex];
      const candidateBox = buildCandidateLabelBox({
        direction: candidateLane.direction,
        gapRem: parseGapRem(candidateLane.gap),
        cardHeightRem,
        startPct,
        endPct,
      });
      const overlapScore = placedBoxes.reduce(
        (total, existingBox) => total + getBoxOverlapScore(candidateBox, existingBox),
        0
      );

      if (overlapScore === 0) {
        laneIndex = candidateIndex;
        bestLaneIndex = candidateIndex;
        bestLaneScore = 0;
        break;
      }

      if (overlapScore < bestLaneScore) {
        bestLaneScore = overlapScore;
        bestLaneIndex = candidateIndex;
      }
    }

    if (bestLaneScore !== 0) {
      laneIndex = bestLaneIndex;
    }

    const lane = laneDefinitions[laneIndex];
    placedBoxes.push(buildCandidateLabelBox({
      direction: lane.direction,
      gapRem: parseGapRem(lane.gap),
      cardHeightRem,
      startPct,
      endPct,
    }));

    layouts.set(milestone.id, {
      alignClass,
      densityClass,
      directionClass: lane.direction === 'above' ? 'is-above' : 'is-below',
      gap: lane.gap,
      cardWidth: densityClass === 'is-compact' ? '6.35rem' : '7.25rem',
    });
  });

  return layouts;
}

function findNearestMilestone(milestones, timelineWindow, pointerX, trackWidth) {
  if (!trackWidth || !milestones.length) return null;

  let nearestMilestone = null;
  let nearestDistance = Infinity;

  milestones.forEach((milestone) => {
    const milestoneCenterX = (getMilestoneLeftPct(milestone.dueDate, timelineWindow) / 100) * trackWidth;
    const distance = Math.abs(pointerX - milestoneCenterX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestMilestone = milestone;
    }
  });

  return nearestDistance <= MILESTONE_FOCUS_THRESHOLD_PX ? nearestMilestone : null;
}

export default function TimelineExperiment({
  timelineRows,
  timelineMarkers,
  timelineWindow,
  timelineRange,
  onProjectClick,
  selectedProjectId,
}) {
  const [hoveredRowId, setHoveredRowId] = useState(null);
  const [pinnedRowId, setPinnedRowId] = useState(null);
  const [hoveredMilestoneRef, setHoveredMilestoneRef] = useState(null);
  const [pinnedMilestoneRef, setPinnedMilestoneRef] = useState(null);
  const [trackPointer, setTrackPointer] = useState(null);
  const pointerFrameRef = useRef(null);
  const queuedPointerRef = useRef(null);

  const activeRowId = pinnedRowId || hoveredRowId;

  const activeRow = useMemo(
    () => timelineRows.find((row) => row.projectId === activeRowId) || null,
    [activeRowId, timelineRows]
  );

  const totalMs = Math.max(1, timelineWindow.end - timelineWindow.start);
  const today = new Date();
  const todayPct = today >= timelineWindow.start && today <= timelineWindow.end
    ? ((today - timelineWindow.start) / totalMs) * 100
    : null;

  const pointerMilestoneId = useMemo(() => {
    if (!activeRow || !trackPointer || trackPointer.projectId !== activeRow.projectId) return null;
    return findNearestMilestone(
      activeRow.milestones,
      timelineWindow,
      trackPointer.x,
      trackPointer.width
    )?.id || null;
  }, [activeRow, timelineWindow, trackPointer]);

  const explicitMilestoneId = activeRow && pinnedMilestoneRef?.projectId === activeRow.projectId
    ? pinnedMilestoneRef.milestoneId
    : activeRow && hoveredMilestoneRef?.projectId === activeRow.projectId
      ? hoveredMilestoneRef.milestoneId
      : null;
  const activeMilestoneId = explicitMilestoneId || pointerMilestoneId;
  const activeRowIndex = activeRow ? timelineRows.findIndex((row) => row.projectId === activeRow.projectId) : -1;
  const activeLaneDefinitions = useMemo(
    () => getOverlayLanesForRow(activeRowIndex, timelineRows.length),
    [activeRowIndex, timelineRows.length]
  );
  const activeOverlayMilestones = useMemo(
    () => (activeRow ? getOverlayMilestones(activeRow.milestones, activeMilestoneId) : []),
    [activeMilestoneId, activeRow]
  );
  const activeMilestoneLayouts = useMemo(
    () => buildOverlayLayouts(activeOverlayMilestones, timelineWindow, activeLaneDefinitions),
    [activeLaneDefinitions, activeOverlayMilestones, timelineWindow]
  );

  useEffect(() => () => {
    if (pointerFrameRef.current) {
      cancelAnimationFrame(pointerFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (pinnedRowId && !timelineRows.some((row) => row.projectId === pinnedRowId)) {
      setPinnedRowId(null);
      setPinnedMilestoneRef(null);
    }
    if (hoveredRowId && !timelineRows.some((row) => row.projectId === hoveredRowId)) {
      setHoveredRowId(null);
    }
    if (hoveredMilestoneRef?.projectId && !timelineRows.some((row) => row.projectId === hoveredMilestoneRef.projectId)) {
      setHoveredMilestoneRef(null);
    }
    if (pinnedMilestoneRef?.projectId && !timelineRows.some((row) => row.projectId === pinnedMilestoneRef.projectId)) {
      setPinnedMilestoneRef(null);
    }
    if (trackPointer?.projectId && !timelineRows.some((row) => row.projectId === trackPointer.projectId)) {
      setTrackPointer(null);
    }
  }, [hoveredMilestoneRef, hoveredRowId, pinnedMilestoneRef, pinnedRowId, timelineRows, trackPointer]);

  const scheduleTrackPointer = (nextPointer) => {
    queuedPointerRef.current = nextPointer;
    if (pointerFrameRef.current) return;

    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      setTrackPointer((current) => {
        const queuedPointer = queuedPointerRef.current;
        if (!queuedPointer) {
          return current ? null : current;
        }

        const sameProject = current?.projectId === queuedPointer.projectId;
        const sameWidth = current?.width === queuedPointer.width;
        const movedEnough = !sameProject || !sameWidth || Math.abs((current?.x ?? 0) - queuedPointer.x) >= 2;
        return movedEnough ? queuedPointer : current;
      });
    });
  };

  const handleRowToggle = (projectId) => {
    if (pinnedRowId === projectId) {
      setPinnedRowId(null);
      setPinnedMilestoneRef(null);
      return;
    }

    setPinnedRowId(projectId);
    setPinnedMilestoneRef((current) => (current?.projectId === projectId ? current : null));
  };

  const clearPreviewForRow = (projectId) => {
    setHoveredRowId((current) => (current === projectId ? null : current));
    setHoveredMilestoneRef((current) => (current?.projectId === projectId ? null : current));
    setTrackPointer((current) => (current?.projectId === projectId ? null : current));
    queuedPointerRef.current = queuedPointerRef.current?.projectId === projectId ? null : queuedPointerRef.current;
  };

  const handleTrackPointerMove = (event, projectId) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    scheduleTrackPointer({ projectId, x, width: rect.width });
  };

  const handleMilestoneToggle = (event, projectId, milestoneId) => {
    event.stopPropagation();
    setPinnedRowId(projectId);
    setPinnedMilestoneRef((current) => (
      current?.projectId === projectId && current?.milestoneId === milestoneId
        ? null
        : { projectId, milestoneId }
    ));
  };

  const handleEscapeCapture = (event, projectId) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (pinnedRowId === projectId) {
      setPinnedRowId(null);
      setPinnedMilestoneRef(null);
    }
    clearPreviewForRow(projectId);
  };

  return (
    <div className="timeline-lab-shell">
      <div className="timeline-lab-surface">
        <div className="timeline-lab-scroll-region">
          <div className="timeline-lab-header-shell">
            <div className="timeline-lab-header">
              <div className="timeline-lab-header-inner">
                <div className="timeline-lab-label-spacer" />
                <div className="timeline-lab-header-months">
                {timelineMarkers.map((marker, index) => {
                  const markerDate = marker.date;
                  const isCurrentMonth = markerDate.getMonth() === today.getMonth() && markerDate.getFullYear() === today.getFullYear();
                  const primaryLabel = marker.primaryLabel || marker.label;
                  const secondaryLabel = marker.secondaryLabel || '';
                  const widthPct = timelineRange === 'programme'
                    ? 100 / Math.max(1, timelineMarkers.length)
                    : undefined;
                  const leftPct = timelineRange === 'programme'
                    ? undefined
                    : ((markerDate - timelineWindow.start) / totalMs) * 100;

                  return (
                    <div
                      key={index}
                      className={`timeline-lab-month ${timelineRange}${isCurrentMonth ? ' current' : ''}${index === 0 ? ' is-first' : ''}${index === timelineMarkers.length - 1 ? ' is-last' : ''}${secondaryLabel ? ' has-secondary' : ''}`}
                      style={timelineRange === 'programme'
                        ? { width: `${widthPct}%` }
                        : { left: `${leftPct}%` }}
                    >
                      <span className="timeline-lab-month-primary">{primaryLabel}</span>
                      {secondaryLabel ? <span className="timeline-lab-month-secondary">{secondaryLabel}</span> : null}
                    </div>
                  );
                })}
                </div>
              </div>
            </div>
          </div>
          <div className="timeline-lab-body">
            {timelineRows.map((row) => {
              const isPinned = pinnedRowId === row.projectId;
              const isActive = activeRowId === row.projectId;
              const isSelected = selectedProjectId === row.projectId;

              return (
                <div
                  key={row.projectId}
                  className={`timeline-lab-row ${isActive ? 'is-active' : ''} ${isPinned ? 'is-pinned' : ''} ${isSelected ? 'is-selected' : ''}`}
                  onMouseEnter={() => setHoveredRowId(row.projectId)}
                  onMouseLeave={() => clearPreviewForRow(row.projectId)}
                  onFocusCapture={() => setHoveredRowId(row.projectId)}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      clearPreviewForRow(row.projectId);
                    }
                  }}
                  onKeyDownCapture={(event) => handleEscapeCapture(event, row.projectId)}
                  onClick={() => handleRowToggle(row.projectId)}
                >
                  <div className="timeline-lab-row-label">
                    <button
                      type="button"
                      className="timeline-lab-project-link"
                      onClick={(event) => {
                        event.stopPropagation();
                        onProjectClick?.(row.projectId);
                      }}
                    >
                      <span className="timeline-lab-project-title">{row.projectTitle}</span>
                    </button>
                  </div>

                  <div
                    className="timeline-lab-track"
                    onMouseMove={(event) => handleTrackPointerMove(event, row.projectId)}
                    onMouseLeave={() => scheduleTrackPointer(null)}
                  >
                    {isActive ? <div className="timeline-lab-track-focus" aria-hidden="true" /> : null}
                    {timelineMarkers.map((marker, index) => {
                      const gridPct = ((marker.date - timelineWindow.start) / totalMs) * 100;
                      return <div key={index} className="timeline-lab-gridline" style={{ left: `${gridPct}%` }} />;
                    })}
                    {todayPct !== null ? <div className="timeline-lab-today" style={{ left: `${todayPct}%` }} /> : null}
                    <div className={`timeline-lab-axis ${row.isEmptyRow ? 'is-empty' : ''}`} />
                    {row.isEmptyRow ? (
                      <div className="timeline-lab-empty-state">
                        <span>{row.emptyMessage}</span>
                      </div>
                    ) : null}

                    {row.milestones.map((milestone) => {
                      const isCompleted = milestone.computedStatus === 'completed';
                      const milestoneLeft = getMilestoneLeftPct(milestone.dueDate, timelineWindow);
                      const overlayLayout = activeMilestoneLayouts.get(milestone.id);
                      const shouldShowOverlay = isActive && Boolean(overlayLayout);
                      const isFocusedMilestone = activeMilestoneId === milestone.id && isActive;
                      const shouldMuteMilestone = isActive && Boolean(explicitMilestoneId) && explicitMilestoneId !== milestone.id && Boolean(overlayLayout);
                      const isMilestonePinned = pinnedMilestoneRef?.projectId === row.projectId
                        && pinnedMilestoneRef?.milestoneId === milestone.id;
                      const mousePullX = isFocusedMilestone && trackPointer?.projectId === row.projectId
                        ? Math.max(
                          -MILESTONE_MOUSE_PULL_LIMIT_PX,
                          Math.min(
                            MILESTONE_MOUSE_PULL_LIMIT_PX,
                            (trackPointer.x - ((milestoneLeft / 100) * trackPointer.width)) * 0.18
                          )
                        )
                        : 0;

                      return (
                        <button
                          type="button"
                          key={milestone.id}
                          className={`timeline-lab-milestone ${isCompleted ? 'is-complete' : 'is-open'} ${isFocusedMilestone ? 'is-focused' : ''} ${isMilestonePinned ? 'is-pinned' : ''} ${shouldMuteMilestone ? 'is-muted' : ''} ${shouldShowOverlay ? `show-label ${overlayLayout.alignClass} ${overlayLayout.densityClass} ${overlayLayout.directionClass}` : ''}`}
                          style={{
                            left: `${milestoneLeft}%`,
                            ...(shouldShowOverlay ? {
                              '--overlay-gap': overlayLayout.gap,
                              '--overlay-card-width': overlayLayout.cardWidth,
                              '--mouse-pull-x': `${mousePullX}px`,
                            } : {}),
                          }}
                          onMouseEnter={() => setHoveredMilestoneRef({ projectId: row.projectId, milestoneId: milestone.id })}
                          onMouseLeave={() => setHoveredMilestoneRef((current) => (
                            current?.projectId === row.projectId && current?.milestoneId === milestone.id
                              ? null
                              : current
                          ))}
                          onFocus={() => {
                            setHoveredRowId(row.projectId);
                            setHoveredMilestoneRef({ projectId: row.projectId, milestoneId: milestone.id });
                          }}
                          onBlur={() => setHoveredMilestoneRef((current) => (
                            current?.projectId === row.projectId && current?.milestoneId === milestone.id
                              ? null
                              : current
                          ))}
                          onClick={(event) => handleMilestoneToggle(event, row.projectId, milestone.id)}
                          aria-pressed={isMilestonePinned}
                          aria-label={`${milestone.title}, ${isCompleted ? 'completed' : formatDate(milestone.dueDate)}. Click to pin this milestone.`}
                        >
                          <span className={`timeline-lab-dot ${isCompleted ? 'is-complete' : 'is-open'}`} />
                          {shouldShowOverlay ? (
                            <span className="timeline-lab-milestone-label">
                              <span className="timeline-lab-milestone-stem" aria-hidden="true" />
                              <span className="timeline-lab-milestone-title">{milestone.title}</span>
                              <span className="timeline-lab-milestone-date">{isCompleted ? 'Completed' : formatDate(milestone.dueDate)}</span>
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
