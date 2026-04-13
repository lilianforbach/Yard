export const SKILL_SYNONYMS = {
  'natural language processing': 'NLP',
  'nlp': 'NLP',
  'machine-learning': 'machine learning',
  'deep-learning': 'deep learning',
  'tda': 'topological data analysis',
  'topological modelling': 'topological data analysis',
  'high performance computing': 'high-performance computing',
  'e-nose': 'electronic nose',
  'electronic noses': 'electronic nose',
  'metagenomic analysis': 'metagenomics',
  'metagenomic': 'metagenomics',
  'microbiome modelling': 'microbiome analysis',
  'knowledge graph': 'knowledge graphs',
  'knowledge-graph': 'knowledge graphs',
  'graph db': 'graph databases',
  'graph database': 'graph databases',
  'stats': 'multivariate statistics',
  'image analysis': 'computer vision',
  'ethics': 'ethics and governance',
  'translation': 'research translation',
  'impact': 'impact assessment',
  'outreach': 'public engagement',
  'tech transfer': 'technology transfer',
};

export function normalizeSkillKey(value) {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[._/]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSkillResolverContext(people = [], skillTaxonomy = {}) {
  const canonicalSkillLookup = new Map();

  Object.values(skillTaxonomy).flat().forEach((skill) => {
    canonicalSkillLookup.set(normalizeSkillKey(skill), skill);
  });

  people.forEach((person) => {
    (person.skills || []).forEach((skill) => {
      const normalized = normalizeSkillKey(skill);
      if (normalized && !canonicalSkillLookup.has(normalized)) {
        canonicalSkillLookup.set(normalized, skill);
      }
    });
  });

  const skillAliasLookup = new Map();
  Object.entries(SKILL_SYNONYMS).forEach(([alias, canonical]) => {
    const resolvedCanonical = canonicalSkillLookup.get(normalizeSkillKey(canonical)) || canonical;
    skillAliasLookup.set(normalizeSkillKey(alias), resolvedCanonical);
  });

  const reverseSkillAliases = new Map();
  skillAliasLookup.forEach((canonical, alias) => {
    if (!reverseSkillAliases.has(canonical)) {
      reverseSkillAliases.set(canonical, []);
    }
    reverseSkillAliases.get(canonical).push(alias);
  });

  return {
    canonicalSkillLookup,
    skillAliasLookup,
    reverseSkillAliases,
  };
}

export function resolveCanonicalSkill(value, context) {
  const normalized = normalizeSkillKey(value);
  if (!normalized) return '';
  return (
    context?.skillAliasLookup?.get(normalized) ||
    context?.canonicalSkillLookup?.get(normalized) ||
    value.trim()
  );
}

export function getSkillSuggestions(query, context, limit = 6) {
  const normalizedQuery = normalizeSkillKey(query);
  if (!normalizedQuery) return [];

  const canonicalValues = new Set([
    ...(context?.canonicalSkillLookup?.values() || []),
    ...(context?.skillAliasLookup?.values() || []),
  ]);

  return Array.from(canonicalValues)
    .map((skill) => {
      const normalized = normalizeSkillKey(skill);
      const aliases = context?.reverseSkillAliases?.get(skill) || [];
      return { value: skill, normalized, aliases };
    })
    .filter(({ normalized, aliases }) => (
      normalized.includes(normalizedQuery) ||
      aliases.some((alias) => alias.includes(normalizedQuery))
    ))
    .sort((a, b) => {
      const aStarts = a.normalized.startsWith(normalizedQuery) ? 0 : 1;
      const bStarts = b.normalized.startsWith(normalizedQuery) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.value.localeCompare(b.value);
    })
    .slice(0, limit);
}
