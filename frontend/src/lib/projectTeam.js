function normalizeIdList(values = []) {
  const seen = new Set();
  const normalized = [];

  values.forEach((value) => {
    const cleaned = typeof value === 'string' ? value.trim() : '';
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    normalized.push(cleaned);
  });

  return normalized;
}

export function getProjectLeadId(project) {
  const explicitLeadId = typeof project?.leadId === 'string' ? project.leadId.trim() : '';
  if (explicitLeadId) return explicitLeadId;

  const legacyLeads = normalizeIdList(Array.isArray(project?.leads) ? project.leads : []);
  if (legacyLeads.length > 0) return legacyLeads[0];

  const legacyLead = typeof project?.lead === 'string' ? project.lead.trim() : '';
  return legacyLead || '';
}

export function getProjectTeamMemberIds(project) {
  const leadId = getProjectLeadId(project);
  const sourceIds = normalizeIdList(
    Array.isArray(project?.teamMemberIds)
      ? project.teamMemberIds
      : Array.isArray(project?.leads)
        ? project.leads
        : project?.lead
          ? [project.lead]
          : []
  );

  if (!leadId) return sourceIds;
  return [leadId, ...sourceIds.filter((memberId) => memberId !== leadId)];
}

export function getProjectContributorIds(project) {
  const leadId = getProjectLeadId(project);
  return getProjectTeamMemberIds(project).filter((memberId) => memberId !== leadId);
}

export function buildProjectTeamPayload(leadId, contributorIds = []) {
  const cleanLeadId = typeof leadId === 'string' ? leadId.trim() : '';
  const normalizedContributors = normalizeIdList(contributorIds).filter((memberId) => memberId !== cleanLeadId);
  const teamMemberIds = cleanLeadId ? [cleanLeadId, ...normalizedContributors] : normalizedContributors;

  return {
    leadId: cleanLeadId,
    teamMemberIds,
  };
}
