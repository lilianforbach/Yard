export function getPublicationKey(publication) {
  if (!publication) return '';
  return publication.doi || publication.url || publication.title || '';
}

export function getPublicationUrl(publication) {
  if (!publication) return '';
  if (publication.url) return publication.url;
  if (publication.doi) return `https://doi.org/${publication.doi}`;
  return '';
}
