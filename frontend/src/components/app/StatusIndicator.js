import React from 'react';
import { statusColors } from '../../lib/constants';

const statusShapes = {
  completed: '✓',
  approaching: '!',
  overdue: '✕',
  'on-track': '–',
};

const statusLabels = {
  completed: 'Completed',
  approaching: 'Approaching deadline',
  overdue: 'Delayed',
  'on-track': 'On track',
};

export default function StatusIndicator({ status, size = 8, className = '' }) {
  const color = statusColors[status] || '#94A3B8';
  const shape = statusShapes[status] || '–';
  const label = statusLabels[status] || status;

  return (
    <span
      className={`status-indicator ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size * 1.5,
        height: size * 1.5,
        borderRadius: '50%',
        backgroundColor: color,
        color: '#fff',
        fontSize: size * 0.75,
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
      }}
      role="img"
      aria-label={label}
      title={label}
    >
      {shape}
    </span>
  );
}
