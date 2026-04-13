import React, { useState, useMemo, useEffect } from 'react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Search, ChevronRight, Plus, X } from 'lucide-react';
import { SectionNotice, SectionSkeleton } from './SectionState';
import api from '../../api';
import { getRoleLabel } from '../../lib/constants';
import { canAccessMaintenance, getMissingProfileFields } from '../../lib/maintenance';
import { canOnboardMembers, getLinkedPerson } from '../../lib/roleAccess';
import OnboardMemberModal from './OnboardMemberModal';
import {
  buildSkillResolverContext,
  normalizeSkillKey,
  resolveCanonicalSkill,
} from '../../lib/skills';
import { matchesSearchQuery } from '../../lib/search';

const OVERVIEW_ROLE_COLUMNS = [
  { key: 'pi', label: 'PIs', roles: ['pi'] },
  { key: 'postdoc', label: 'Postdocs', roles: ['postdoc'] },
  { key: 'phd', label: 'PhD Students', roles: ['phd'] },
];

const PROGRAMME_TEAM_ROLES = new Set(['staff', 'coordinator']);
const DIRECTORY_ROLE_FILTERS = [
  { value: 'all', label: 'Any role' },
  { value: 'pi', label: 'PIs' },
  { value: 'postdoc', label: 'Postdocs' },
  { value: 'phd', label: 'PhD students' },
  { value: 'programme-team', label: 'Programme team' },
];
const EQUIPMENT_QUICK_STARTS = ['HPLC', 'FT-IR', 'bioreactor', 'flow cytometer', 'depth camera', 'MinION'];

function comparePeopleByName(a, b) {
  return a.name.localeCompare(b.name);
}

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getDirectoryRoleLabel(role) {
  return PROGRAMME_TEAM_ROLES.has(role) ? 'Programme team' : getRoleLabel(role);
}

function getRoleFilterValue(role) {
  return PROGRAMME_TEAM_ROLES.has(role) ? 'programme-team' : role;
}

function compareSharedDirectoryResults(a, b) {
  if (a.isProgrammeSupport !== b.isProgrammeSupport) {
    return Number(a.isProgrammeSupport) - Number(b.isProgrammeSupport);
  }
  return a.person.name.localeCompare(b.person.name);
}

function prioritizeMatches(matches, allItems, limit = 3) {
  return [
    ...matches,
    ...allItems.filter((item) => !matches.includes(item)),
  ].slice(0, limit);
}

export default function People({ onPersonClick }) {
  const { people, institutions, getInstitution, getPerson, loading, refreshResources, resourceStatus } = useData();
  const { permissions, refreshPermissions } = useAuth();
  const { showToast } = useToast();
  const [view, setView] = useState('overview');
  const [search, setSearch] = useState('');
  const [expertiseRoleFilter, setExpertiseRoleFilter] = useState('all');
  const [expertiseInstitutionFilter, setExpertiseInstitutionFilter] = useState('all');
  const [equipmentRoleFilter, setEquipmentRoleFilter] = useState('all');
  const [equipmentInstitutionFilter, setEquipmentInstitutionFilter] = useState('all');
  const [skillTaxonomy, setSkillTaxonomy] = useState({});
  const [showAddPerson, setShowAddPerson] = useState(false);
  const hasSearch = search.trim().length > 0;

  // Fetch skill taxonomy on mount
  useEffect(() => {
    api.get('/skill-taxonomy').then(res => {
      setSkillTaxonomy(res.data || {});
    }).catch(() => {});
  }, []);

  const institutionNames = useMemo(() => (
    institutions.reduce((accumulator, institution) => {
      accumulator[institution.id] = institution.name;
      return accumulator;
    }, {})
  ), [institutions]);
  const institutionFilterOptions = useMemo(() => ([
    { value: 'all', label: 'Any institution' },
    ...institutions.map((institution) => ({ value: institution.id, label: institution.name })),
  ]), [institutions]);

  const skillResolver = useMemo(() => (
    buildSkillResolverContext(people, skillTaxonomy)
  ), [people, skillTaxonomy]);

  const personSkillMeta = useMemo(() => (
    people.reduce((accumulator, person) => {
      const canonicalSkills = Array.from(new Set((person.skills || [])
        .map((skill) => resolveCanonicalSkill(skill, skillResolver))
        .filter(Boolean)));
      const searchTerms = new Set();

      canonicalSkills.forEach((skill) => {
        searchTerms.add(normalizeSkillKey(skill));
        (skillResolver.reverseSkillAliases.get(skill) || []).forEach((alias) => searchTerms.add(alias));
      });

      (person.skills || []).forEach((skill) => {
        searchTerms.add(normalizeSkillKey(skill));
      });

      accumulator[person.id] = { canonicalSkills, searchTerms };
      return accumulator;
    }, {})
  ), [people, skillResolver]);

  const filtered = useMemo(() => {
    return people.filter(p =>
      matchesSearchQuery(
        search,
        p.name,
        p.title,
        p.researchDescription,
        institutionNames[p.institution],
        getDirectoryRoleLabel(p.role),
        Array.from(personSkillMeta[p.id]?.searchTerms || []),
        (p.equipment || []).flatMap((equipment) => [equipment.name, equipment.description])
      )
    );
  }, [institutionNames, people, personSkillMeta, search]);

  const programmeTeam = useMemo(() => (
    filtered
      .filter((person) => PROGRAMME_TEAM_ROLES.has(person.role))
      .sort(comparePeopleByName)
  ), [filtered]);

  const overviewRows = useMemo(() => (
    institutions
      .map((institution) => {
        const institutionPeople = filtered
          .filter((person) => person.institution === institution.id && !PROGRAMME_TEAM_ROLES.has(person.role))
          .sort(comparePeopleByName);

        const byRole = OVERVIEW_ROLE_COLUMNS.reduce((accumulator, column) => {
          accumulator[column.key] = institutionPeople.filter((person) => column.roles.includes(person.role));
          return accumulator;
        }, {});

        return {
          institution,
          byRole,
          total: institutionPeople.length,
        };
      })
      .filter((row) => row.total > 0)
  ), [filtered, institutions]);

  // Build skill index: { skillName: [personId, ...] }
  const skillIndex = useMemo(() => {
    const idx = {};
    people.forEach(p => {
      (personSkillMeta[p.id]?.canonicalSkills || []).forEach(s => {
        if (!idx[s]) idx[s] = [];
        idx[s].push(p.id);
      });
    });
    return idx;
  }, [people, personSkillMeta]);

  // All shared expertise terms sorted by frequency
  const allSkills = useMemo(() => {
    return Object.entries(skillIndex)
      .map(([name, ids]) => ({
        name,
        count: ids.length,
        searchTerms: [
          normalizeSkillKey(name),
          ...(skillResolver.reverseSkillAliases.get(name) || []),
        ],
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [skillResolver, skillIndex]);

  const expertiseSuggestions = useMemo(() => (
    (search.trim()
      ? allSkills.filter((skill) => matchesSearchQuery(search, skill.name, skill.searchTerms))
      : allSkills
    ).slice(0, 10)
  ), [allSkills, search]);

  const expertiseMatches = useMemo(() => (
    people
      .map((person) => {
        const canonicalSkills = personSkillMeta[person.id]?.canonicalSkills || [];
        if (canonicalSkills.length === 0) return null;

        const matchingSkills = search.trim()
          ? canonicalSkills.filter((skill) => (
            matchesSearchQuery(search, skill, skillResolver.reverseSkillAliases.get(skill) || [])
          ))
          : canonicalSkills;

        if (search.trim() && matchingSkills.length === 0) return null;

        return {
          person,
          institution: getInstitution(person.institution),
          displayedSkills: prioritizeMatches(matchingSkills, canonicalSkills),
          roleFilterValue: getRoleFilterValue(person.role),
          isProgrammeSupport: PROGRAMME_TEAM_ROLES.has(person.role),
        };
      })
      .filter(Boolean)
      .sort(compareSharedDirectoryResults)
  ), [getInstitution, people, personSkillMeta, search, skillResolver.reverseSkillAliases]);

  const visibleExpertiseMatches = useMemo(() => (
    expertiseMatches.filter((result) => {
      const institutionMatch = expertiseInstitutionFilter === 'all'
        || result.person.institution === expertiseInstitutionFilter;
      const roleMatch = expertiseRoleFilter === 'all'
        || result.roleFilterValue === expertiseRoleFilter;
      return institutionMatch && roleMatch;
    })
  ), [expertiseInstitutionFilter, expertiseMatches, expertiseRoleFilter]);
  const expertiseInstitutionCount = useMemo(() => (
    new Set(visibleExpertiseMatches.map((result) => result.person.institution)).size
  ), [visibleExpertiseMatches]);

  const allEquipment = useMemo(() => {
    const index = new Map();

    people.forEach((person) => {
      (person.equipment || []).forEach((equipment) => {
        const name = equipment.name?.trim();
        if (!name) return;
        const key = normalizeSkillKey(name);
        const existing = index.get(key);

        if (existing) {
          existing.count += 1;
          if (equipment.description?.trim()) {
            existing.searchTerms.add(equipment.description.trim());
          }
          return;
        }

        index.set(key, {
          key,
          name,
          count: 1,
          searchTerms: new Set([name, equipment.description?.trim()].filter(Boolean)),
        });
      });
    });

    return Array.from(index.values())
      .map((item) => ({
        ...item,
        searchTerms: Array.from(item.searchTerms),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [people]);

  const equipmentMatches = useMemo(() => (
    people
      .map((person) => {
        const equipmentItems = (person.equipment || []).filter((item) => item.name?.trim());
        if (equipmentItems.length === 0) return null;

        const matchingEquipment = search.trim()
          ? equipmentItems.filter((item) => (
            matchesSearchQuery(search, item.name, item.description)
          ))
          : equipmentItems;

        if (search.trim() && matchingEquipment.length === 0) return null;

        return {
          person,
          institution: getInstitution(person.institution),
          displayedEquipment: prioritizeMatches(matchingEquipment, equipmentItems),
          roleFilterValue: getRoleFilterValue(person.role),
          isProgrammeSupport: PROGRAMME_TEAM_ROLES.has(person.role),
        };
      })
      .filter(Boolean)
      .sort(compareSharedDirectoryResults)
  ), [getInstitution, people, search]);

  const visibleEquipmentMatches = useMemo(() => (
    equipmentMatches.filter((result) => {
      const institutionMatch = equipmentInstitutionFilter === 'all'
        || result.person.institution === equipmentInstitutionFilter;
      const roleMatch = equipmentRoleFilter === 'all'
        || result.roleFilterValue === equipmentRoleFilter;
      return institutionMatch && roleMatch;
    })
  ), [equipmentInstitutionFilter, equipmentMatches, equipmentRoleFilter]);
  const equipmentInstitutionCount = useMemo(() => (
    new Set(visibleEquipmentMatches.map((result) => result.person.institution)).size
  ), [visibleEquipmentMatches]);

  const linkedPerson = getLinkedPerson(permissions, getPerson);
  const maintenanceAccess = canAccessMaintenance(permissions, linkedPerson);
  const canOnboard = canOnboardMembers(permissions);

  const handleOnboardComplete = async (result, { openProfile = false } = {}) => {
    await refreshResources(['people']);
    await refreshPermissions();
    setShowAddPerson(false);
    showToast('Member profile created and invite link ready.');
    if (openProfile && result?.person?.id) {
      onPersonClick?.(result.person.id);
    }
  };

  const clearSearch = () => setSearch('');
  const toggleSuggestedSearch = (value) => {
    setSearch((current) => (
      normalizeSkillKey(current) === normalizeSkillKey(value) ? '' : value
    ));
  };
  const renderSearchBox = (placeholder) => (
    <div className="search-box search-box-prominent">
      <Search size={16} />
      <input
        data-testid="people-search"
        type="text"
        placeholder={placeholder}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {hasSearch && (
        <button
          type="button"
          className="search-box-clear"
          onClick={clearSearch}
          aria-label="Clear search"
          title="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );

  if (loading && people.length === 0) {
    return <SectionSkeleton cards={6} />;
  }

  if (people.length === 0 && (resourceStatus.people.status === 'error' || resourceStatus.institutions.status === 'error')) {
    return (
      <SectionNotice
        title="People data is unavailable"
        message={resourceStatus.people.error || resourceStatus.institutions.error || 'The people directory could not be loaded.'}
        onRetry={() => refreshResources(['people', 'institutions'])}
      />
    );
  }

  return (
    <section data-testid="people-section" className="section active">
      <div className="section-controls">
        <div className="view-toggle">
          <button data-testid="people-overview-view" className={`filter-btn ${view === 'overview' ? 'active' : ''}`} onClick={() => { setView('overview'); setSearch(''); }}>Overview</button>
          <button data-testid="people-skills-view" className={`filter-btn ${view === 'skills' ? 'active' : ''}`} onClick={() => { setView('skills'); setSearch(''); }}>Expertise</button>
          <button data-testid="people-equipment-view" className={`filter-btn ${view === 'equipment' ? 'active' : ''}`} onClick={() => { setView('equipment'); setSearch(''); }}>Equipment</button>
        </div>
        {view === 'overview' && renderSearchBox('Search people, institutions, or shared topics...')}
        {canOnboard && (
          <button
            data-testid="people-onboard-member"
            className="action-btn small"
            onClick={() => setShowAddPerson(true)}
          >
            <Plus size={14} /> Onboard Member
          </button>
        )}
      </div>

      {/* ── OVERVIEW VIEW (Matrix) ── */}
      {view === 'overview' && (
        <div className="people-overview">
          {filtered.length === 0 ? (
            <div className="people-overview-empty-state">
              <h4>No people found</h4>
              <p>Try a different name, institution, expertise, or equipment term.</p>
            </div>
          ) : overviewRows.length === 0 ? (
            <div className="people-overview-empty-state">
              <h4>No research-role matches in the grid</h4>
              <p>This search currently matches programme-team profiles only, which are shown below the matrix.</p>
            </div>
          ) : (
            <div className="people-matrix-shell">
              <div className="people-matrix-scroll">
                <div className="people-matrix">
                  <div className="people-matrix-row people-matrix-header">
                    <div className="people-matrix-cell people-matrix-col-header"></div>
                    {OVERVIEW_ROLE_COLUMNS.map((column) => (
                      <div key={column.key} className="people-matrix-cell people-matrix-col-header">{column.label}</div>
                    ))}
                  </div>
                  {overviewRows.map((row) => (
                    <div
                      key={row.institution.id}
                      className="people-matrix-row people-matrix-body-row"
                      style={{ '--institution-accent': row.institution.color || 'var(--color-border)' }}
                    >
                      <div className="people-matrix-cell people-matrix-inst-col">
                        <div className="people-matrix-inst-name">{row.institution.name}</div>
                      </div>
                      {OVERVIEW_ROLE_COLUMNS.map((column) => (
                        <div key={column.key} className="people-matrix-cell people-matrix-role-cell">
                          {row.byRole[column.key].length > 0 ? (
                            <div className="people-matrix-person-list">
                              {row.byRole[column.key].map((person) => {
                                const missingFields = maintenanceAccess ? getMissingProfileFields(person) : [];
                                const needsAttention = missingFields.length > 0;
                                const attentionLabel = needsAttention
                                  ? `Needs attention: missing ${missingFields.join(', ')}`
                                  : null;

                                return (
                                  <button
                                    key={person.id}
                                    type="button"
                                    className={`people-matrix-person ${needsAttention ? 'needs-attention' : ''}`}
                                    onClick={() => onPersonClick(person.id)}
                                    title={attentionLabel || undefined}
                                  >
                                    <div className="people-matrix-name-row">
                                      <div className="people-matrix-name">{person.name} <ChevronRight size={12} className="clickable-chevron" /></div>
                                      {needsAttention && <span className="people-matrix-attention-dot" aria-hidden="true" />}
                                    </div>
                                    {attentionLabel && <span className="sr-only">{attentionLabel}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="people-matrix-empty">—</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {programmeTeam.length > 0 && (
            <div className="people-programme-strip">
              <div className="people-programme-strip-header">
                <div>
                  <h4>Programme team</h4>
                </div>
              </div>
              <div className="people-programme-strip-list">
                {programmeTeam.map((person) => {
                  const institution = getInstitution(person.institution);
                  const missingFields = maintenanceAccess ? getMissingProfileFields(person) : [];
                  const needsAttention = missingFields.length > 0;
                  const attentionLabel = needsAttention
                    ? `Needs attention: missing ${missingFields.join(', ')}`
                    : null;

                  return (
                    <button
                      key={person.id}
                      type="button"
                      className={`people-programme-card ${needsAttention ? 'needs-attention' : ''}`}
                      onClick={() => onPersonClick(person.id)}
                      title={attentionLabel || undefined}
                    >
                      <div className="people-programme-card-top">
                        <div className="people-programme-card-name">{person.name} <ChevronRight size={12} className="clickable-chevron" /></div>
                        {needsAttention && <span className="people-matrix-attention-dot" aria-hidden="true" />}
                      </div>
                      <div className="people-programme-card-role">{person.title || getRoleLabel(person.role)}</div>
                      {institution?.name && <div className="people-programme-card-meta">{institution.name}</div>}
                      {attentionLabel && <span className="sr-only">{attentionLabel}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── EXPERTISE VIEW (Two-panel) ── */}
      {view === 'skills' && (
        <div className="skills-two-panel">
          <div className="skills-left-panel">
            <div className="skills-panel-intro">
              <h4>Find the right people faster</h4>
            </div>
            <div className="skills-search-block">
              {renderSearchBox('Search by method, topic, or type of help')}
            </div>
            {allSkills.length > 0 && (
              <div className="skills-featured-block">
                <div className="skills-featured-header">
                  <span className="skills-featured-title">{hasSearch ? 'Matching topics' : 'Try:'}</span>
                </div>
                <div className="skills-tag-list">
                  {expertiseSuggestions.map((skill) => (
                    <button
                      key={skill.name}
                      type="button"
                      className={`skills-tag-btn ${normalizeSkillKey(search) === normalizeSkillKey(skill.name) ? 'selected' : ''}`}
                      onClick={() => toggleSuggestedSearch(skill.name)}
                    >
                      {skill.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {allSkills.length === 0 && (
              <div className="skills-left-empty-state">
                <h4>No shared expertise yet</h4>
                <p>People can add a few things they would be happy to be contacted about from their profile.</p>
              </div>
            )}
          </div>
          <div className="skills-right-panel">
            {allSkills.length === 0 ? (
              <div className="skills-empty-prompt">
                <div className="skills-empty-copy">
                  <span className="skills-panel-eyebrow">People</span>
                  <h4>No one is sharing expertise here yet</h4>
                  <p>This view will populate once people start highlighting a few things they are happy to be contacted about.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="skills-results-header">
                  <div className="skills-results-summary">
                    <h4>{search.trim() ? `People matching "${search}"` : 'People sharing expertise'}</h4>
                    <p className="skills-helper-copy">
                      {formatCount(visibleExpertiseMatches.length, 'person', 'people')}
                      {expertiseInstitutionCount > 0 ? ` across ${formatCount(expertiseInstitutionCount, 'institution', 'institutions')}` : ''}
                    </p>
                  </div>
                  <div className="skills-results-controls">
                    <div className="skills-filter-group">
                      <span className="skills-filter-group-label">Role</span>
                      <div className="skills-filter-pill-row">
                        {DIRECTORY_ROLE_FILTERS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`skills-filter-pill ${expertiseRoleFilter === option.value ? 'active' : ''}`}
                            onClick={() => setExpertiseRoleFilter(option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="skills-filter-group">
                      <span className="skills-filter-group-label">Institution</span>
                      <div className="skills-filter-pill-row">
                        {institutionFilterOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`skills-filter-pill ${expertiseInstitutionFilter === option.value ? 'active' : ''}`}
                            onClick={() => setExpertiseInstitutionFilter(option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                {visibleExpertiseMatches.length === 0 ? (
                  <div className="skills-empty-prompt compact">
                    <div className="skills-empty-copy">
                      <h4>No people match this search</h4>
                      <p>Try a broader topic, or clear the role and institution filters.</p>
                    </div>
                  </div>
                ) : (
                  <div className="skills-people-list">
                    {visibleExpertiseMatches.map((result) => {
                      const { person, institution, displayedSkills } = result;
                      const metaParts = [person.title?.trim(), institution?.name].filter(Boolean);
                      return (
                        <button key={person.id} type="button" className="skills-person-card" onClick={() => onPersonClick(person.id)} style={{ borderLeftColor: institution?.color || '#E5E7EB' }}>
                          <div className="skills-person-info">
                            <div className="skills-person-header">
                              <div className="skills-person-name">{person.name} <ChevronRight size={12} className="clickable-chevron" /></div>
                            </div>
                            {metaParts.length > 0 && (
                              <div className="skills-person-meta">{metaParts.join(' • ')}</div>
                            )}
                            <div className="skills-person-matching">
                              {displayedSkills.map((skill) => (
                                <span key={skill} className="skills-match-tag">{skill}</span>
                              ))}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── EQUIPMENT VIEW (People-first) ── */}
      {view === 'equipment' && (
        <div className="skills-two-panel">
          <div className="skills-left-panel">
            <div className="skills-panel-intro">
              <h4>Find the right people faster</h4>
            </div>
            <div className="skills-search-block">
              {renderSearchBox('Search by tool, setup, or technique')}
            </div>
            {allEquipment.length > 0 && !hasSearch && (
              <div className="skills-featured-block">
                <div className="skills-featured-header">
                  <span className="skills-featured-title">Try:</span>
                </div>
                <div className="skills-tag-list">
                  {EQUIPMENT_QUICK_STARTS.map((term) => (
                    <button
                      key={term}
                      type="button"
                      className={`skills-tag-btn ${normalizeSkillKey(search) === normalizeSkillKey(term) ? 'selected' : ''}`}
                      onClick={() => toggleSuggestedSearch(term)}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {allEquipment.length === 0 && (
              <div className="skills-left-empty-state">
                <h4>No shared equipment support yet</h4>
                <p>People can list the equipment or setups they would be happy to advise on from their profile.</p>
              </div>
            )}
          </div>
          <div className="skills-right-panel">
            {allEquipment.length === 0 ? (
              <div className="skills-empty-prompt">
                <div className="skills-empty-copy">
                  <span className="skills-panel-eyebrow">People</span>
                  <h4>No one is sharing equipment support here yet</h4>
                  <p>This view will populate once people start highlighting equipment or setups they can help others navigate.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="skills-results-header">
                  <div className="skills-results-summary">
                    <h4>{search.trim() ? `People matching "${search}"` : 'People offering equipment support'}</h4>
                    <p className="skills-helper-copy">
                      {formatCount(visibleEquipmentMatches.length, 'person', 'people')}
                      {equipmentInstitutionCount > 0 ? ` across ${formatCount(equipmentInstitutionCount, 'institution', 'institutions')}` : ''}
                    </p>
                  </div>
                  <div className="skills-results-controls">
                    <div className="skills-filter-group">
                      <span className="skills-filter-group-label">Role</span>
                      <div className="skills-filter-pill-row">
                        {DIRECTORY_ROLE_FILTERS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`skills-filter-pill ${equipmentRoleFilter === option.value ? 'active' : ''}`}
                            onClick={() => setEquipmentRoleFilter(option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="skills-filter-group">
                      <span className="skills-filter-group-label">Institution</span>
                      <div className="skills-filter-pill-row">
                        {institutionFilterOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`skills-filter-pill ${equipmentInstitutionFilter === option.value ? 'active' : ''}`}
                            onClick={() => setEquipmentInstitutionFilter(option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                {visibleEquipmentMatches.length === 0 ? (
                  <div className="skills-empty-prompt compact">
                    <div className="skills-empty-copy">
                      <h4>No people match this search</h4>
                      <p>Try a broader equipment term, or clear the role and institution filters.</p>
                    </div>
                  </div>
                ) : (
                  <div className="skills-people-list">
                    {visibleEquipmentMatches.map((result) => {
                      const { person, institution, displayedEquipment } = result;
                      const metaParts = [person.title?.trim(), institution?.name].filter(Boolean);
                      return (
                        <button key={person.id} type="button" className="skills-person-card" onClick={() => onPersonClick(person.id)} style={{ borderLeftColor: institution?.color || '#E5E7EB' }}>
                          <div className="skills-person-info">
                            <div className="skills-person-header">
                              <div className="skills-person-name">{person.name} <ChevronRight size={12} className="clickable-chevron" /></div>
                            </div>
                            {metaParts.length > 0 && (
                              <div className="skills-person-meta">{metaParts.join(' • ')}</div>
                            )}
                            <div className="skills-person-detail-list">
                              {displayedEquipment.map((item) => (
                                <div key={`${person.id}-${item.name}`} className="skills-person-detail-item">
                                  <div className="skills-person-detail-name">{item.name}</div>
                                  {item.description && <div className="skills-person-detail-desc">{item.description}</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {showAddPerson && (
        <OnboardMemberModal
          institutions={institutions}
          onClose={() => setShowAddPerson(false)}
          onComplete={handleOnboardComplete}
        />
      )}
    </section>
  );
}
