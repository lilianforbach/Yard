import React from 'react';
import { useData } from '../../contexts/DataContext';
import { formatDate } from '../../lib/constants';
import SlidePanel from './SlidePanel';

export default function EventPanel({ eventId, onClose }) {
  const { events } = useData();
  const event = events.find((candidate) => candidate.id === eventId);

  if (!event) return null;

  const agenda = event.schedule || event.agenda || [];
  const header = (
    <>
      <h2>{event.name}</h2>
      <div className="panel-meta">
        <span className="inst-badge">{formatDate(event.date)}</span>
        {event.location && <span className="inst-badge">{event.location}</span>}
      </div>
    </>
  );

  return (
    <SlidePanel
      onClose={onClose}
      testId="event-panel"
      headerContent={header}
      showOverlay={false}
      panelClassName="event-slide-panel"
      ariaLabel={`${event.name} event details`}
    >
      {event.description && (
        <div className="panel-section">
          <h4>Overview</h4>
          <p className="event-detail-desc">{event.description}</p>
        </div>
      )}

      {agenda.length > 0 ? (
        <div className="event-schedule">
          <h4>Agenda</h4>
          <div className="agenda-items">
            {agenda.map((item, index) => (
              <div key={index} className="schedule-item">
                <div className="schedule-item-time">{item.time}</div>
                <div className="schedule-item-content">
                  <div className="schedule-item-title">{item.title}</div>
                  {item.speaker && <div className="schedule-item-speaker">{item.speaker}</div>}
                  {(item.desc || item.description) && <div className="schedule-item-desc">{item.desc || item.description}</div>}
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
  );
}
