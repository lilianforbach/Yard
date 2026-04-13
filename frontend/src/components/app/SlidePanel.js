import React from 'react';
import { X } from 'lucide-react';
import useDialogA11y from './useDialogA11y';

/**
 * Shared slide-in panel container.
 *
 * Props
 * ─────
 *  onClose        – callback when overlay / X / Escape pressed
 *  testId         – data-testid for the panel root
 *  headerStyle    – optional inline style for the panel-header (e.g. borderBottomColor)
 *  headerContent  – React node rendered inside .panel-header (below the close button)
 *  showOverlay    – whether to render the dismiss overlay (default true)
 *  panelClassName – optional extra class for panel-specific styling
 *  children       – rendered inside .panel-body
 */
export default function SlidePanel({
  onClose,
  testId,
  headerStyle,
  headerContent,
  showOverlay = true,
  panelClassName = '',
  ariaLabel = 'Details panel',
  children,
}) {
  const { dialogRef } = useDialogA11y(onClose);

  return (
    <>
      {showOverlay && <div className="panel-overlay" onClick={onClose} aria-hidden="true" />}
      <div
        ref={dialogRef}
        data-testid={testId}
        className={`slide-out-panel open ${panelClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        <div className="panel-header" style={headerStyle}>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close panel"><X size={20} /></button>
          {headerContent}
        </div>
        <div className="panel-body">
          {children}
        </div>
      </div>
    </>
  );
}
