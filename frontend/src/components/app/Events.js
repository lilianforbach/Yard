import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../../contexts/DataContext';
import { ChevronRight, Search } from 'lucide-react';
import { formatDate } from '../../lib/constants';
import { matchesSearchQuery } from '../../lib/search';
import SlidePanel from './SlidePanel';
import { SectionNotice, SectionSkeleton } from './SectionState';

export default function Events() {
  const { events, loading, refreshResource, resourceStatus } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState('upcoming');
  const [search, setSearch] = useState('');
  const selectedEventId = searchParams.get('event');

  const filtered = useMemo(() => {
    const nextEvents = filter === 'all'
      ? events
      : events.filter((event) => (
        filter === 'past' ? event.status === 'past' : event.status !== 'past'
      ));

    const searchedEvents = nextEvents.filter((event) => (
      matchesSearchQuery(
        search,
        event.name,
        event.location,
        event.description,
        event.materials,
        (event.agenda || []).flatMap((item) => [item.time, item.title, item.speaker, item.description])
      )
    ));

    return [...searchedEvents].sort((a, b) => {
      if (filter === 'past') {
        return (b.date || '').localeCompare(a.date || '');
      }
      return (a.date || '').localeCompare(b.date || '');
    });
  }, [events, filter, search]);

  useEffect(() => {
    if (selectedEventId && !filtered.find((event) => event.id === selectedEventId)) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('event');
      setSearchParams(nextParams, { replace: true });
    }
  }, [filtered, searchParams, selectedEventId, setSearchParams]);

  const selectedEvent = filtered.find(e => e.id === selectedEventId);
  const closeSelectedEvent = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('event');
    setSearchParams(nextParams, { replace: true });
  };

  const panelHeader = selectedEvent ? (
    <>
      <h2>{selectedEvent.name}</h2>
      <div className="panel-meta">
        <span className="inst-badge">{formatDate(selectedEvent.date)}</span>
        <span className="inst-badge">{selectedEvent.location}</span>
      </div>
    </>
  ) : null;

  if (loading && events.length === 0) {
    return <SectionSkeleton cards={4} />;
  }

  if (events.length === 0 && resourceStatus.events.status === 'error') {
    return (
      <SectionNotice
        title="Events are unavailable"
        message={resourceStatus.events.error || 'The event calendar could not be loaded.'}
        onRetry={() => refreshResource('events')}
      />
    );
  }

  return (
    <section data-testid="events-section" className="section active">
      <div className="section-controls">
        <div className="view-toggle events-list-filters">
          <button data-testid="events-upcoming-filter" className={`filter-btn ${filter === 'upcoming' ? 'active' : ''}`} onClick={() => setFilter('upcoming')}>Upcoming</button>
          <button data-testid="events-past-filter" className={`filter-btn ${filter === 'past' ? 'active' : ''}`} onClick={() => setFilter('past')}>Past</button>
          <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
        </div>
        <div className="search-box">
          <Search size={16} />
          <input
            data-testid="events-search"
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div className="events-layout">
        <div className="events-list-panel">
          {filtered.length > 0 ? (
            <div className="events-list-scroll">
              {filtered.map((event) => {
                return (
                  <button
                    key={event.id}
                    type="button"
                    data-testid={`event-list-item-${event.id}`}
                    className={`event-list-item ${selectedEventId === event.id ? 'active' : ''}`}
                    onClick={() => {
                      const nextParams = new URLSearchParams(searchParams);
                      nextParams.set('event', event.id);
                      setSearchParams(nextParams, { replace: true });
                    }}
                  >
                    <div className="event-list-item-main">
                      <div className="event-list-item-title-block">
                        <h4>{event.name}</h4>
                        <ChevronRight size={16} className="event-list-item-arrow" aria-hidden="true" />
                      </div>
                      <div className="event-list-item-meta">
                        <span>{formatDate(event.date)}</span>
                        {event.location ? (
                          <>
                            <span className="event-list-item-meta-sep" aria-hidden="true">•</span>
                            <span>{event.location}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="event-empty-detail events-list-empty">
              No {filter} events
            </div>
          )}
        </div>
      </div>

      {selectedEvent && (
        <SlidePanel
          onClose={closeSelectedEvent}
          testId="event-panel"
          headerContent={panelHeader}
          showOverlay={false}
          panelClassName="event-slide-panel"
          ariaLabel={`${selectedEvent.name} event details`}
        >
          {selectedEvent.description && (
            <div className="panel-section">
              <h4>Overview</h4>
              <p className="event-detail-desc">{selectedEvent.description}</p>
            </div>
          )}

          {(selectedEvent.schedule || selectedEvent.agenda || []).length > 0 ? (
            <div className="event-schedule">
              <h4>Agenda</h4>
              <div className="agenda-items">
                {(selectedEvent.schedule || selectedEvent.agenda || []).map((item, i) => (
                  <div key={i} className="schedule-item">
                    <div className="schedule-item-time">{item.time}</div>
                    <div className="schedule-item-content">
                      <div className="schedule-item-title">{item.title}</div>
                      {item.speaker && <div className="schedule-item-speaker">{item.speaker}</div>}
                      {item.desc && <div className="schedule-item-desc">{item.desc}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="event-empty-detail">
              Agenda details have not been added for this event yet.
            </div>
          )}
        </SlidePanel>
      )}
    </section>
  );
}
