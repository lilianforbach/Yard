import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import useDialogA11y from './useDialogA11y';

export default function WritingModal({
  title,
  subtitle = '',
  onClose,
  children,
  footer = null,
  className = '',
}) {
  const { dialogRef, titleId } = useDialogA11y(onClose);
  const descriptionId = subtitle ? `${titleId}-description` : undefined;

  const modal = (
    <div className="modal-overlay" onClick={onClose} aria-hidden="true">
      <div
        ref={dialogRef}
        className={`modal-content writing-modal ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close editor">
          <X size={20} />
        </button>
        <div className="writing-modal-header">
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={descriptionId} className="form-subtitle">{subtitle}</p>}
        </div>
        <div className="writing-modal-body">
          {children}
        </div>
        {footer && <div className="writing-modal-footer">{footer}</div>}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
