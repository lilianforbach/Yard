function flattenValues(values, output = []) {
  values.forEach((value) => {
    if (Array.isArray(value)) {
      flattenValues(value, output);
      return;
    }

    if (value == null || value === false) return;
    output.push(String(value));
  });

  return output;
}

export function normalizeSearchText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function getSearchTokens(query = '') {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(' ') : [];
}

export function matchesSearchQuery(query, ...fields) {
  const tokens = getSearchTokens(query);
  if (tokens.length === 0) return true;

  const searchableValues = flattenValues(fields)
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);

  if (searchableValues.length === 0) return false;

  return tokens.every((token) => searchableValues.some((value) => value.includes(token)));
}
