import React, { useMemo } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { useData } from '../../contexts/DataContext';
import { formatDate } from '../../lib/constants';
import { getPublicationKey, getPublicationUrl } from '../../lib/publications';
import { matchesSearchQuery } from '../../lib/search';
import { SectionNotice, SectionSkeleton } from './SectionState';

export default function Publications() {
  const { publications, loading, refreshResource, resourceStatus } = useData();
  const [search, setSearch] = React.useState('');

  const filtered = useMemo(() => {
    return publications.filter((publication) => (
      matchesSearchQuery(
        search,
        publication.title,
        publication.authors,
        publication.venue,
        publication.abstract,
        publication.doi
      )
    ));
  }, [publications, search]);

  const sortedPublications = useMemo(
    () => [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [filtered]
  );

  if (loading && publications.length === 0) {
    return <SectionSkeleton cards={5} />;
  }

  if (publications.length === 0 && resourceStatus.publications.status === 'error') {
    return (
      <SectionNotice
        title="Publications are unavailable"
        message={resourceStatus.publications.error || 'The publication feed could not be loaded.'}
        onRetry={() => refreshResource('publications')}
      />
    );
  }

  return (
    <section data-testid="publications-section" className="section active">
      <div className="section-controls">
        <div className="search-box section-search">
          <Search size={16} />
          <input
            data-testid="publications-search"
            type="text"
            placeholder="Search publications, authors, venues..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="publications-layout">
        <div className="publications-list-panel">
          <div className="publications-scroll">
            {sortedPublications.length === 0 ? (
              <p className="empty-state publications-empty">No publications match your search.</p>
            ) : (
              sortedPublications.map((publication) => {
                const publicationKey = getPublicationKey(publication);
                const publicationUrl = getPublicationUrl(publication);

                const rowContent = (
                  <>
                    <div className="publication-list-main">
                      <div className="publication-list-title-row">
                        <h3>{publication.title}</h3>
                        <ChevronRight size={16} className="publication-list-chevron" aria-hidden="true" />
                      </div>
                      <div className="publication-list-secondary">
                        <div className="publication-list-meta">
                          <span>{publication.venue || 'Venue not recorded'}</span>
                          {publication.date ? (
                            <>
                              <span className="publication-list-meta-sep" aria-hidden="true">•</span>
                              <span>{formatDate(publication.date)}</span>
                            </>
                          ) : null}
                        </div>
                        {publication.authors ? (
                          <div className="publication-list-meta publication-list-authors">{publication.authors}</div>
                        ) : null}
                      </div>
                    </div>
                  </>
                );

                if (publicationUrl) {
                  return (
                    <a
                      key={publicationKey}
                      data-testid={`publication-item-${publicationKey}`}
                      className="publication-list-row"
                      href={publicationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {rowContent}
                    </a>
                  );
                }

                return (
                  <div
                    key={publicationKey}
                    data-testid={`publication-item-${publicationKey}`}
                    className="publication-list-row"
                  >
                    {rowContent}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
