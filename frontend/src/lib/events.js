function parseEventDay(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function getTodayDay() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isEventUpcoming(event, today = getTodayDay()) {
  const eventDay = parseEventDay(event?.date);
  if (!eventDay) return false;
  return eventDay >= today;
}

export function isEventPast(event, today = getTodayDay()) {
  const eventDay = parseEventDay(event?.date);
  if (!eventDay) return false;
  return eventDay < today;
}
