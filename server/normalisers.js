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

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normaliseCopernicusValue(key, value) {
  const numeric = toNumber(value);
  if (numeric == null) return { key: null, value: null };

  const lowered = key.toLowerCase();
  if (
    lowered.includes('significant_wave_height') ||
    lowered === 'vhm0' ||
    lowered === 'wave_height' ||
    lowered === 'swh'
  ) {
    return { key: 'wave', value: numeric };
  }

  if (
    lowered.includes('wind_speed') ||
    lowered === 'ff' ||
    lowered === 'uwnd' ||
    lowered === 'vwnd'
  ) {
    return { key: 'wind', value: numeric };
  }

  if (
    lowered.includes('wind_from_direction') ||
    lowered.includes('wind_direction') ||
    lowered === 'vmdr'
  ) {
    return { key: 'windDir', value: numeric };
  }

  if (
    lowered.includes('sea_surface_temperature') ||
    lowered.includes('sea_water_temperature') ||
    lowered === 'sst' ||
    lowered === 'temperature'
  ) {
    const adjusted = numeric > 200 ? numeric - 273.15 : numeric;
    return { key: 'temp', value: adjusted };
  }

  return { key: null, value: null };
}

function coerceCopernicusTime(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{8}T\d{6}$/.test(trimmed)) {
      const iso = `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T${trimmed.slice(9, 11)}:${trimmed.slice(11, 13)}:${trimmed.slice(13)}`;
      const parsed = new Date(iso);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function ensureRecord(map, isoTime) {
  const existing = map.get(isoTime);
  if (existing) return existing;
  const record = { time: isoTime, wave: null, wind: null, windDir: null, temp: null };
  map.set(isoTime, record);
  return record;
}

function consumeCopernicusVariable(map, name, descriptor) {
  if (!descriptor) return;
  const times = Array.isArray(descriptor?.time)
    ? descriptor.time
    : Array.isArray(descriptor?.times)
    ? descriptor.times
    : Array.isArray(descriptor?.datetime)
    ? descriptor.datetime
    : Array.isArray(descriptor?.dates)
    ? descriptor.dates
    : Array.isArray(descriptor?.timestamps)
    ? descriptor.timestamps
    : Array.isArray(descriptor?.records)
    ? descriptor.records
    : [];

  const values = Array.isArray(descriptor?.value)
    ? descriptor.value
    : Array.isArray(descriptor?.values)
    ? descriptor.values
    : Array.isArray(descriptor?.data)
    ? descriptor.data
    : [];

  const length = Math.min(times.length, values.length);

  for (let index = 0; index < length; index += 1) {
    const timeCandidate = times[index]?.time ?? times[index]?.datetime ?? times[index]?.date ?? times[index];
    const isoTime = coerceCopernicusTime(timeCandidate);
    if (!isoTime) continue;

    const rawValue = values[index]?.value ?? values[index];
    const { key, value } = normaliseCopernicusValue(name, rawValue);
    if (!key) continue;

    const record = ensureRecord(map, isoTime);
    record[key] = value;
  }
}

function consumeCopernicusArray(map, entry) {
  if (!entry) return;
  const time =
    entry?.time ?? entry?.datetime ?? entry?.date ?? entry?.timestamp ?? entry?.t ?? entry?.Time ?? entry?.TIME ?? null;
  const isoTime = coerceCopernicusTime(time);
  if (!isoTime) return;

  const record = ensureRecord(map, isoTime);
  Object.entries(entry).forEach(([name, value]) => {
    if (name === 'time' || name === 'datetime' || name === 'date' || name === 'timestamp' || name === 't') return;
    const { key, value: numeric } = normaliseCopernicusValue(name, value);
    if (key) {
      record[key] = numeric;
    }
  });
}

export function normaliseCopernicusForecast(payload) {
  const records = new Map();

  if (Array.isArray(payload?.data)) {
    payload.data.forEach((entry) => consumeCopernicusArray(records, entry));
  }

  if (Array.isArray(payload?.records)) {
    payload.records.forEach((entry) => consumeCopernicusArray(records, entry));
  }

  if (payload?.variables && typeof payload.variables === 'object') {
    Object.entries(payload.variables).forEach(([name, descriptor]) => {
      consumeCopernicusVariable(records, name, descriptor);
    });
  }

  if (payload?.result && typeof payload.result === 'object') {
    Object.entries(payload.result).forEach(([name, descriptor]) => {
      consumeCopernicusVariable(records, name, descriptor);
    });
  }

  const entries = Array.from(records.values()).sort((a, b) => new Date(a.time) - new Date(b.time));

  const time = [];
  const wave = [];
  const wind = [];
  const windDir = [];
  const temp = [];

  entries.forEach((entry) => {
    const timestamp = coerceCopernicusTime(entry.time);
    if (!timestamp) return;
    time.push(timestamp);
    wave.push(Number.isFinite(entry.wave) ? entry.wave : null);
    wind.push(Number.isFinite(entry.wind) ? entry.wind : null);
    windDir.push(Number.isFinite(entry.windDir) ? entry.windDir : null);
    temp.push(Number.isFinite(entry.temp) ? entry.temp : null);
  });

  return {
    source: 'copernicus',
    hourly: {
      time,
      wave_height: wave,
      wind_speed_10m: wind,
      wind_direction_10m: windDir,
      temperature_2m: temp,
    },
  };
}
