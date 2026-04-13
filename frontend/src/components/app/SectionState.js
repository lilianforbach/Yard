import React from 'react';

export function SectionSkeleton({ cards = 3 }) {
  return (
    <div className="section-skeleton" aria-hidden="true">
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="section-skeleton-card">
          <div className="section-skeleton-line wide" />
          <div className="section-skeleton-line" />
          <div className="section-skeleton-line short" />
        </div>
      ))}
    </div>
  );
}

export function SectionNotice({ title, message, onRetry, actionLabel = 'Retry' }) {
  return (
    <div className="section-notice" role="status">
      <strong>{title}</strong>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="section-notice-action" onClick={onRetry}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
