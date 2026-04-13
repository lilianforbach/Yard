// Shared constants and utility functions used across components

// Status dot/badge colors
export const statusColors = {
  completed: '#10B981',
  approaching: '#F59E0B',
  overdue: '#EF4444',
  'on-track': '#94A3B8',
};

// Status badge background colors (for pills/badges)
export const statusBgColors = {
  completed: '#D1FAE5',
  approaching: '#FEF3C7',
  overdue: '#FEE2E2',
  'on-track': '#E2E8F0',
};

// Status badge text colors
export const statusTextColors = {
  completed: '#065F46',
  approaching: '#92400E',
  overdue: '#991B1B',
  'on-track': '#475569',
};

// Role labels
export const roleLabels = {
  pi: 'PI',
  postdoc: 'Postdoc',
  phd: 'PhD Student',
  staff: 'Programme Team',
  coordinator: 'Programme Team',
  management: 'Management',
  collaborator: 'Collaborator',
};

// Role badge colors
export const roleBadgeColors = {
  pi: { bg: '#DBEAFE', text: '#1E40AF' },
  postdoc: { bg: '#E0E7FF', text: '#3730A3' },
  phd: { bg: '#CFFAFE', text: '#155E75' },
  staff: { bg: '#FEF3C7', text: '#92400E' },
  coordinator: { bg: '#FEF3C7', text: '#92400E' },
  management: { bg: '#FEF3C7', text: '#92400E' },
  collaborator: { bg: '#F3E8FF', text: '#6B21A8' },
};

// Severity colors for challenges
export const severityColors = {
  critical: { bg: '#FEE2E2', text: '#991B1B', border: '#EF4444' },
  major: { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B' },
  minor: { bg: '#E2E8F0', text: '#475569', border: '#94A3B8' },
};

// Helper functions
export const getStatusDotColor = (status) => statusColors[status] || '#94A3B8';
export const getRoleLabel = (role) => roleLabels[role] || role;
export const getRoleBadgeColor = (role) => roleBadgeColors[role] || { bg: '#F3F4F6', text: '#374151' };

// Format date helper
export const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 2) {
      const d = new Date(parts[0], parts[1] - 1);
      return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    }
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};
