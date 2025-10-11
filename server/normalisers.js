function parseIsoDuration(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  if (/^P/.test(value)) {
    const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (match) {
      const hours = Number.parseInt(match[1] ?? '0', 10);
      const minutes = Number.parseInt(match[2] ?? '0', 10);
      return hours * 60 + minutes;
    }
  }
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

export function normaliseFlightOffers(raw) {
  const candidates = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
    ? raw.data
    : Array.isArray(raw?.trips)
    ? raw.trips
    : Array.isArray(raw?.results)
    ? raw.results
    : Array.isArray(raw?.best_flights)
    ? raw.best_flights
    : [];

  return candidates
    .map((item) => {
      const firstLeg = Array.isArray(item?.legs) ? item.legs[0] : item?.leg ?? null;
      const priceRaw =
        item?.price?.amount ??
        item?.price?.value ??
        item?.price ??
        item?.fare ??
        (typeof item?.saleTotal === 'string'
          ? Number.parseFloat(item.saleTotal.replace(/^[A-Z]{3}/, ''))
          : null);
      const currency =
        item?.price?.currency ??
        item?.currency ??
        (typeof item?.saleTotal === 'string' ? item.saleTotal.slice(0, 3) : 'EUR');
      const durationMinutes =
        parseIsoDuration(item?.duration) ??
        parseIsoDuration(item?.travelDuration) ??
        parseIsoDuration(item?.duration_mins) ??
        parseIsoDuration(firstLeg?.duration);
      const departure =
        item?.departure ??
        item?.departure_time ??
        firstLeg?.departure ??
        firstLeg?.departure_time ??
        firstLeg?.departureTime;
      const arrival =
        item?.arrival ??
        item?.arrival_time ??
        firstLeg?.arrival ??
        firstLeg?.arrival_time ??
        firstLeg?.arrivalTime;
      const airline =
        item?.airline ??
        item?.carrier ??
        firstLeg?.airline ??
        (Array.isArray(item?.airlines) ? item.airlines.join(', ') : null);

      if (!Number.isFinite(priceRaw)) return null;

      return {
        price: Number(priceRaw),
        currency,
        durationMinutes,
        departure,
        arrival,
        airline,
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

export function normaliseSncfJourneys(raw) {
  const journeys = Array.isArray(raw?.journeys) ? raw.journeys : [];
  return journeys.slice(0, 3).map((journey) => ({
    durationSeconds: journey?.duration ?? null,
    departureDateTime: journey?.departure_date_time ?? null,
    arrivalDateTime: journey?.arrival_date_time ?? null,
    price: journey?.fare?.total ?? null,
    currency: journey?.fare?.currency ?? 'EUR',
    transfers: journey?.nb_transfers ?? null,
  }));
}

export function formatFlightDate(date) {
  return date.toISOString().split('T')[0];
}

function pad(value) {
  return value.toString().padStart(2, '0');
}

export function formatSncfDatetime(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(
    date.getMinutes()
  )}00`;
}
