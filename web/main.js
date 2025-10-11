const statusEl = document.querySelector('#status');
const spotsGrid = document.querySelector('#spots');
const spotTemplate = document.querySelector('#spot-template');
const locateBtn = document.querySelector('#locate-btn');
const searchBtn = document.querySelector('#search-btn');
const locationInput = document.querySelector('#location-input');
const originAirportInput = document.querySelector('#origin-airport-input');
const flightHostInput = document.querySelector('#flight-host-input');
const flightKeyInput = document.querySelector('#flight-key-input');
const sncfKeyInput = document.querySelector('#sncf-key-input');

const defaultSurfSpots = [
  {
    id: 'hossegor',
    name: 'Hossegor',
    region: 'Nouvelle-Aquitaine, France',
    latitude: 43.663,
    longitude: -1.441,
    airportCode: 'BIQ',
  },
  {
    id: 'nazare',
    name: 'Nazaré',
    region: 'Leiria, Portugal',
    latitude: 39.602,
    longitude: -9.07,
    airportCode: 'LIS',
  },
  {
    id: 'muna-point',
    name: 'Mundaka',
    region: 'Basque Country, Spain',
    latitude: 43.407,
    longitude: -2.693,
    airportCode: 'BIO',
  },
  {
    id: 'fistral',
    name: 'Fistral Beach',
    region: 'Cornwall, United Kingdom',
    latitude: 50.413,
    longitude: -5.099,
    airportCode: 'NQY',
  },
  {
    id: 'sagres',
    name: 'Sagres',
    region: 'Algarve, Portugal',
    latitude: 37.008,
    longitude: -8.943,
    airportCode: 'FAO',
  },
  {
    id: 'scheveningen',
    name: 'Scheveningen',
    region: 'South Holland, Netherlands',
    latitude: 52.109,
    longitude: 4.274,
    airportCode: 'AMS',
  },
];
let surfSpots = [...defaultSurfSpots];
let spotById = new Map(defaultSurfSpots.map((spot) => [spot.id, spot]));

function setSurfSpots(spots) {
  surfSpots = Array.isArray(spots) && spots.length ? spots : [...defaultSurfSpots];
  spotById = new Map(surfSpots.map((spot) => [spot.id, spot]));
}

async function loadSurfSpotsFromBackend() {
  try {
    const response = await fetch('/api/spots');
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if (Array.isArray(payload?.spots) && payload.spots.length) {
      setSurfSpots(payload.spots);
      updateSpots();
    }
  } catch (error) {
    console.warn('Unable to load surf spots from backend, using defaults', error);
  }
}

let userLocation = null;

const storageKey = 'surf-trip-planner-settings';
const defaultSettings = {
  originAirport: '',
  flightApi: {
    host: 'google-flights43.p.rapidapi.com',
    key: '',
  },
  sncfApi: {
    key: '',
  },
};

function loadSettings() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...defaultSettings };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { ...defaultSettings };
    }
    const parsed = JSON.parse(raw);
    return {
      originAirport: parsed?.originAirport ?? defaultSettings.originAirport,
      flightApi: {
        host: parsed?.flightApi?.host ?? defaultSettings.flightApi.host,
        key: parsed?.flightApi?.key ?? defaultSettings.flightApi.key,
      },
      sncfApi: {
        key: parsed?.sncfApi?.key ?? defaultSettings.sncfApi.key,
      },
    };
  } catch (error) {
    console.warn('Unable to read saved settings', error);
    return { ...defaultSettings };
  }
}

let settings = loadSettings();

function persistSettings() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch (error) {
    console.warn('Unable to persist settings', error);
  }
}

function applySettingsToInputs() {
  if (originAirportInput) {
    originAirportInput.value = settings.originAirport;
  }
  if (flightHostInput) {
    flightHostInput.value = settings.flightApi.host;
  }
  if (flightKeyInput) {
    flightKeyInput.value = settings.flightApi.key;
  }
  if (sncfKeyInput) {
    sncfKeyInput.value = settings.sncfApi.key;
  }
}

applySettingsToInputs();

const spotState = new Map();
let updateSequence = 0;

function sanitizeAirport(value) {
  return (value ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
}

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message ?? '';
  statusEl.classList.toggle('error', isError);
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function estimateTravel(distanceKm) {
  const planeCostPerKm = 0.12;
  const trainCostPerKm = 0.09;
  const planeBase = 55;
  const trainBase = 25;
  const planeSpeed = 700; // km/h
  const trainSpeed = 160;

  const planePrice = planeBase + planeCostPerKm * distanceKm;
  const trainPrice = trainBase + trainCostPerKm * distanceKm;

  const planeDuration = distanceKm / planeSpeed;
  const trainDuration = distanceKm / trainSpeed;

  return {
    plane: {
      price: planePrice,
      durationHours: planeDuration,
    },
    train: {
      price: trainPrice,
      durationHours: trainDuration,
    },
  };
}

async function fetchForecast(spot) {
  const backendParams = new URLSearchParams({
    spotId: spot.id ?? '',
    lat: spot.latitude,
    lon: spot.longitude,
  });
  try {
    const backendResponse = await fetch(`/api/forecast?${backendParams.toString()}`);
    if (backendResponse.ok) {
      return backendResponse.json();
    }
    if (backendResponse.status && backendResponse.status !== 404) {
      const errorPayload = await backendResponse.json().catch(async () => ({
        error: await backendResponse.text().catch(() => 'Forecast request failed'),
      }));
      throw new Error(errorPayload.error || 'Unable to fetch forecast data');
    }
  } catch (error) {
    console.warn('Falling back to direct forecast fetch', error);
  }

  const params = new URLSearchParams({
    latitude: spot.latitude,
    longitude: spot.longitude,
    hourly: 'wave_height,wind_speed_10m,wind_direction_10m,temperature_2m',
    daily: 'wave_height_max,swell_height_max,swell_direction_dominant',
    timezone: 'auto',
  });

  const response = await fetch(
    `https://marine-api.open-meteo.com/v1/marine?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error('Unable to fetch forecast data');
  }

  return response.json();
}

function summariseForecast(data) {
  if (!data?.hourly?.time?.length) return null;
  const { time, wave_height, wind_speed_10m, wind_direction_10m, temperature_2m } =
    data.hourly;

  const summary = [];
  const byDay = {};

  time.forEach((iso, index) => {
    const date = new Date(iso);
    const key = date.toISOString().split('T')[0];
    if (!byDay[key]) {
      byDay[key] = [];
    }
    byDay[key].push({
      date,
      wave: wave_height[index],
      wind: wind_speed_10m[index],
      windDir: wind_direction_10m[index],
      temp: temperature_2m[index],
    });
  });

  Object.entries(byDay)
    .slice(0, 3)
    .forEach(([key, values]) => {
      const displayDate = new Date(key);
      const average = values.reduce(
        (acc, value) => {
          acc.wave += value.wave;
          acc.wind += value.wind;
          acc.windDir += value.windDir;
          acc.temp += value.temp;
          return acc;
        },
        { wave: 0, wind: 0, windDir: 0, temp: 0 }
      );

      const length = values.length || 1;
      summary.push({
        date: displayDate.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        wave: average.wave / length,
        wind: average.wind / length,
        windDir: average.windDir / length,
        temp: average.temp / length,
      });
    });

  return summary;
}

function formatHoursDuration(hours) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function formatMinutesDuration(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

function formatSecondsDuration(seconds) {
  if (!Number.isFinite(seconds)) return null;
  return formatMinutesDuration(seconds / 60);
}

function formatCurrency(value, currency = 'EUR') {
  if (!Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch (error) {
    console.warn('Unable to format currency', currency, error);
    return `${value.toFixed(0)} ${currency}`;
  }
}

function getUpcomingTripDate() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7;
  const target = new Date(now);
  target.setHours(9, 0, 0, 0);
  target.setDate(now.getDate() + daysUntilSaturday);
  return target;
}

function formatFlightDate(date) {
  return date.toISOString().split('T')[0];
}

function formatSncfDatetime(date) {
  const pad = (value) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(
    date.getHours()
  )}${pad(date.getMinutes())}00`;
}

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

function normaliseFlightOffers(raw) {
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

async function fetchFlightOffers({ origin, destination, departureDate }) {
  const backendPayload = {
    origin,
    destination,
    departureDate: departureDate?.toISOString?.() ?? departureDate,
    rapidApi: {
      host: settings.flightApi.host,
      key: settings.flightApi.key,
    },
  };
  try {
    const response = await fetch('/api/flights', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backendPayload),
    });
    if (response.status === 404) {
      const error = new Error('Flights backend not available.');
      error.code = 'BACKEND_MISSING';
      throw error;
    }
    if (!response.ok) {
      const errorPayload = await response.json().catch(async () => ({
        error: await response.text().catch(() => 'Failed to fetch flight offers.'),
      }));
      throw new Error(errorPayload.error || 'Failed to fetch flight offers.');
    }
    const payload = await response.json();
    if (Array.isArray(payload?.offers)) {
      return payload.offers;
    }
    if (payload?.error) {
      throw new Error(payload.error);
    }
    return [];
  } catch (error) {
    if (error?.code !== 'BACKEND_MISSING' && error?.name !== 'TypeError') {
      throw error;
    }
    console.warn('Falling back to client-side flights fetch', error);
  }

  const hostHeader = settings.flightApi.host.trim().replace(/^https?:\/\//i, '');
  if (!hostHeader) {
    throw new Error('Missing RapidAPI host for Google Flights.');
  }
  const url = new URL(`https://${hostHeader}/search`);
  url.searchParams.set('from', origin);
  url.searchParams.set('to', destination);
  url.searchParams.set('departure', formatFlightDate(departureDate));
  url.searchParams.set('currency', 'EUR');
  url.searchParams.set('adults', '1');

  const response = await fetch(url.toString(), {
    headers: {
      'X-RapidAPI-Key': settings.flightApi.key,
      'X-RapidAPI-Host': hostHeader,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Flights request failed (${response.status} ${response.statusText}). ${text.slice(0, 120)}`
    );
  }

  const data = await response.json();
  return normaliseFlightOffers(data);
}
function parseSncfDateTime(value) {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10),
    Number.parseInt(minute, 10),
    Number.parseInt(second, 10)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function normaliseSncfJourneys(raw) {
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

async function findNearestSncfStopArea({ latitude, longitude }) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Invalid coordinates provided for SNCF lookup.');
  }

  const token = settings.sncfApi.key.trim();
  if (!token) {
    throw new Error('Missing SNCF API token.');
  }

  const url = new URL(
    `https://api.sncf.com/v1/coverage/sncf/coords/${longitude};${latitude}/places_nearby`
  );
  url.searchParams.set('type[]', 'stop_area');
  url.searchParams.set('count', '1');
  url.searchParams.set('distance', '20000');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${btoa(`${token}:`)}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const fallbackLabel = `${response.status} ${response.statusText}`.trim();
    const text = await response.text().catch(() => '');
    throw new Error(
      text
        ? `SNCF station lookup failed: ${text.slice(0, 120)}`
        : `SNCF station lookup failed: ${fallbackLabel}`
    );
  }

  const payload = await response.json();
  const candidate = Array.isArray(payload?.places_nearby)
    ? payload.places_nearby.find(
        (place) => place?.embedded_type === 'stop_area' && place?.stop_area?.id
      )
    : null;

  if (!candidate?.stop_area?.id) {
    return null;
  }

  return {
    id: candidate.stop_area.id,
    name: candidate.stop_area.name ?? candidate.stop_area.label ?? 'Unknown station',
    label: candidate.stop_area.label ?? candidate.stop_area.name ?? candidate.stop_area.id,
    distanceMeters: Number.isFinite(candidate.distance) ? candidate.distance : null,
  };
}

async function fetchSncfJourneys({ from, to, departureDate }) {
  const backendPayload = {
    from,
    to,
    departureDate: departureDate?.toISOString?.() ?? departureDate,
    sncf: {
      key: settings.sncfApi.key,
    },
  };
  try {
    const response = await fetch('/api/trains', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backendPayload),
    });
    if (response.status === 404) {
      const error = new Error('Rail backend not available.');
      error.code = 'BACKEND_MISSING';
      throw error;
    }
    if (!response.ok) {
      const errorPayload = await response.json().catch(async () => ({
        error: await response.text().catch(() => 'Failed to fetch rail journeys.'),
      }));
      throw new Error(errorPayload.error || 'Failed to fetch rail journeys.');
    }
    const payload = await response.json();
    if (Array.isArray(payload?.journeys)) {
      return {
        journeys: payload.journeys,
        arrivalStation: payload?.arrivalStation ?? null,
        originStation: payload?.originStation ?? null,
      };
    }
    if (payload?.error) {
      throw new Error(payload.error);
    }
    return {
      journeys: [],
      arrivalStation: payload?.arrivalStation ?? null,
      originStation: payload?.originStation ?? null,
    };
  } catch (error) {
    if (error?.code !== 'BACKEND_MISSING' && error?.name !== 'TypeError') {
      throw error;
    }
    console.warn('Falling back to client-side rail fetch', error);
  }

  const arrivalStation = await findNearestSncfStopArea(to);
  if (!arrivalStation) {
    throw new Error('No SNCF station found near the destination location.');
  }

  let originStation = null;
  try {
    originStation = await findNearestSncfStopArea(from);
  } catch (stationError) {
    console.warn('Failed to resolve origin station, falling back to coordinates', stationError);
  }

  const url = new URL('https://api.sncf.com/v1/coverage/sncf/journeys');
  url.searchParams.set(
    'from',
    originStation ? originStation.id : `${from.longitude};${from.latitude}`
  );
  url.searchParams.set('to', arrivalStation.id);
  url.searchParams.set('datetime', formatSncfDatetime(departureDate));
  url.searchParams.set('datetime_represents', 'departure');
  url.searchParams.set('count', '3');

  const token = settings.sncfApi.key.trim();
  if (!token) {
    throw new Error('Missing SNCF API token.');
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${btoa(`${token}:`)}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const fallbackLabel = `${response.status} ${response.statusText}`.trim();
    const text = await response.text().catch(() => '');
    let friendlyMessage = '';
    if (text) {
      try {
        const payload = JSON.parse(text);
        if (payload?.error?.message) {
          friendlyMessage = payload.error.message;
        }
      } catch (error) {
        // Ignore JSON parse issues, we'll fall back to the raw snippet below.
      }
    }
    throw new Error(
      friendlyMessage
        ? `SNCF request failed: ${friendlyMessage}`
        : `SNCF request failed: ${fallbackLabel}. ${text.slice(0, 120)}`
    );
  }

  const data = await response.json();
  return {
    journeys: normaliseSncfJourneys(data),
    arrivalStation,
    originStation,
  };
}

function tryParseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}\d{2}\d{2}T/.test(value)) {
    return parseSncfDateTime(value);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) {
    const asIso = value.replace(' ', 'T');
    const utc = new Date(`${asIso}Z`);
    if (!Number.isNaN(utc.getTime())) return utc;
    const local = new Date(asIso);
    if (!Number.isNaN(local.getTime())) return local;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTimeLabel(date, { timeOnly = false } = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const options = timeOnly
    ? { hour: '2-digit', minute: '2-digit' }
    : { weekday: 'short', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleString(undefined, options).replace(',', '');
}

function createParagraph(text, className) {
  const p = document.createElement('p');
  p.textContent = text;
  if (className) {
    p.className = className;
  }
  return p;
}

function renderTravelSection(spot, state) {
  if (!userLocation) {
    return '<h4>Travel options</h4><p>Set your location to calculate routes.</p>';
  }

  const travel = state?.travel;
  if (!travel) {
    return '<h4>Travel options</h4><p>Calculating travel details…</p>';
  }

  const container = document.createElement('div');
  container.className = 'travel';

  const heading = document.createElement('h4');
  heading.textContent = 'Travel options';
  container.appendChild(heading);

  if (typeof travel.distanceKm === 'number') {
    container.appendChild(
      createParagraph(`Distance: ${travel.distanceKm.toFixed(0)} km`)
    );
  }

  if (travel.scheduleDate instanceof Date && !Number.isNaN(travel.scheduleDate.getTime())) {
    container.appendChild(
      createParagraph(
        `Target date: ${travel.scheduleDate.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}`
      )
    );
  }

  if (travel.heuristics) {
    const heuristicsSection = document.createElement('div');
    heuristicsSection.className = 'travel-subsection';
    const heuristicsHeading = document.createElement('h5');
    heuristicsHeading.textContent = 'Distance-based estimate';
    heuristicsSection.appendChild(heuristicsHeading);
    heuristicsSection.appendChild(
      createParagraph(
        `Train: ${formatCurrency(travel.heuristics.train.price, 'EUR')} · ${formatHoursDuration(
          travel.heuristics.train.durationHours
        )}`
      )
    );
    heuristicsSection.appendChild(
      createParagraph(
        `Flight: ${formatCurrency(travel.heuristics.plane.price, 'EUR')} · ${formatHoursDuration(
          travel.heuristics.plane.durationHours
        )}`
      )
    );
    container.appendChild(heuristicsSection);
  }

  const flightsSection = document.createElement('div');
  flightsSection.className = 'travel-subsection';
  const flightHeading = document.createElement('h5');
  flightHeading.textContent = 'Flights via Google Flights';
  flightsSection.appendChild(flightHeading);

  if (travel.loadingFlights) {
    flightsSection.appendChild(createParagraph('Fetching live flight prices…'));
  } else if (Array.isArray(travel.flightOffers) && travel.flightOffers.length) {
    const list = document.createElement('ul');
    travel.flightOffers.forEach((offer) => {
      const li = document.createElement('li');
      const departureDate = tryParseDate(offer.departure);
      const arrivalDate = tryParseDate(offer.arrival);
      const parts = [];
      if (departureDate) {
        const label = arrivalDate
          ? `${formatDateTimeLabel(departureDate)} → ${formatDateTimeLabel(arrivalDate, {
              timeOnly: true,
            })}`
          : formatDateTimeLabel(departureDate);
        parts.push(label);
      }
      if (offer.airline) {
        parts.push(offer.airline);
      }
      if (Number.isFinite(offer.price)) {
        parts.push(formatCurrency(offer.price, offer.currency ?? 'EUR'));
      }
      const durationLabel = formatMinutesDuration(offer.durationMinutes);
      if (durationLabel) {
        parts.push(`Duration ${durationLabel}`);
      }
      li.textContent = parts.join(' · ');
      list.appendChild(li);
    });
    flightsSection.appendChild(list);
  } else if (travel.flightError) {
    flightsSection.appendChild(
      createParagraph(`Flights: ${travel.flightError}`, 'travel-error')
    );
  } else {
    flightsSection.appendChild(createParagraph('No flight information available.'));
  }

  container.appendChild(flightsSection);

  const railSection = document.createElement('div');
  railSection.className = 'travel-subsection';
  const railHeading = document.createElement('h5');
  railHeading.textContent = 'Rail via SNCF';
  railSection.appendChild(railHeading);

  if (travel.arrivalStation?.name) {
    let label = `Nearest station: ${travel.arrivalStation.name}`;
    if (Number.isFinite(travel.arrivalStation.distanceMeters)) {
      const distanceMeters = travel.arrivalStation.distanceMeters;
      if (distanceMeters >= 1000) {
        const km = distanceMeters / 1000;
        const precision = km >= 10 ? 0 : 1;
        label += ` (${km.toFixed(precision)} km from the spot)`;
      } else if (distanceMeters > 0) {
        label += ` (${Math.round(distanceMeters)} m from the spot)`;
      }
    }
    railSection.appendChild(createParagraph(label, 'travel-note'));
  }

  if (travel.loadingTrains) {
    railSection.appendChild(createParagraph('Fetching live rail journeys…'));
  } else if (Array.isArray(travel.trainJourneys) && travel.trainJourneys.length) {
    const list = document.createElement('ul');
    travel.trainJourneys.forEach((journey) => {
      const li = document.createElement('li');
      const departureDate = tryParseDate(journey.departureDateTime);
      const arrivalDate = tryParseDate(journey.arrivalDateTime);
      const parts = [];
      if (departureDate) {
        const label = arrivalDate
          ? `${formatDateTimeLabel(departureDate)} → ${formatDateTimeLabel(arrivalDate, {
              timeOnly: true,
            })}`
          : formatDateTimeLabel(departureDate);
        parts.push(label);
      }
      const durationLabel = formatSecondsDuration(journey.durationSeconds);
      if (durationLabel) {
        parts.push(`Duration ${durationLabel}`);
      }
      if (Number.isFinite(journey.transfers) && journey.transfers >= 0) {
        parts.push(`${journey.transfers} transfer${journey.transfers === 1 ? '' : 's'}`);
      }
      if (Number.isFinite(journey.price)) {
        parts.push(formatCurrency(journey.price, journey.currency ?? 'EUR'));
      }
      li.textContent = parts.join(' · ');
      list.appendChild(li);
    });
    railSection.appendChild(list);
  } else if (travel.trainError) {
    railSection.appendChild(createParagraph(`Rail: ${travel.trainError}`, 'travel-error'));
  } else {
    railSection.appendChild(
      createParagraph('No rail journeys available for the selected time.')
    );
  }

  container.appendChild(railSection);

  const wrapper = document.createElement('div');
  wrapper.appendChild(container);
  return wrapper.innerHTML;
}

function renderSpotCard(spot, state = {}) {
  const clone = spotTemplate.content.cloneNode(true);
  const article = clone.querySelector('.spot-card');
  article.dataset.spotId = spot.id;
  const nameEl = clone.querySelector('.spot-name');
  const locationEl = clone.querySelector('.spot-location');
  const forecastEl = clone.querySelector('.forecast');
  const travelEl = clone.querySelector('.travel');

  nameEl.textContent = spot.name;
  locationEl.textContent = spot.region;

  if (Array.isArray(state.forecast) && state.forecast.length) {
    const list = document.createElement('div');
    list.className = 'forecast-list';
    state.forecast.forEach((entry) => {
      const p = document.createElement('p');
      p.innerHTML = `<strong>${entry.date}</strong> · Wave ${entry.wave.toFixed(1)} m · Wind ${entry.wind.toFixed(
        1
      )} m/s · Temp ${entry.temp.toFixed(0)} °C`;
      list.appendChild(p);
    });
    forecastEl.innerHTML = '<h4>Next days</h4>';
    forecastEl.append(list);
  } else if (state.forecastError) {
    forecastEl.innerHTML = `<h4>Next days</h4><p>${state.forecastError}</p>`;
  } else {
    forecastEl.innerHTML = '<h4>Next days</h4><p>Loading marine forecast…</p>';
  }

  travelEl.outerHTML = renderTravelSection(spot, state);

  return article;
}

function refreshSpotCard(spot) {
  const existing = spotsGrid.querySelector(`[data-spot-id="${spot.id}"]`);
  if (!existing) return;
  const newArticle = renderSpotCard(spot, spotState.get(spot.id) ?? {});
  spotsGrid.replaceChild(newArticle, existing);
}

function updateSpotState(spotId, updater) {
  const state = spotState.get(spotId);
  if (!state) return;
  updater(state);
  const spot = spotById.get(spotId);
  if (spot) {
    refreshSpotCard(spot);
  }
}

async function updateSpots() {
  const runToken = ++updateSequence;
  spotsGrid.innerHTML = '';
  spotState.clear();

  const tripDate = getUpcomingTripDate();

  for (const spot of surfSpots) {
    const state = { forecast: null, travel: null };
    spotState.set(spot.id, state);
    const article = renderSpotCard(spot, state);
    spotsGrid.appendChild(article);

    fetchForecast(spot)
      .then((data) => {
        if (runToken !== updateSequence) return;
        const summary = summariseForecast(data);
        updateSpotState(spot.id, (draft) => {
          draft.forecast = summary;
          draft.forecastError = !summary?.length
            ? 'No marine forecast available.'
            : null;
        });
      })
      .catch((error) => {
        if (runToken !== updateSequence) return;
        updateSpotState(spot.id, (draft) => {
          draft.forecastError = error.message ?? 'Weather data unavailable.';
          draft.forecast = null;
        });
      });

    if (!userLocation) {
      continue;
    }

    const distanceKm = haversineDistance(
      userLocation.latitude,
      userLocation.longitude,
      spot.latitude,
      spot.longitude
    );
    const heuristics = estimateTravel(distanceKm);

    const hasDestinationAirport = Boolean(spot.airportCode);
    const hasOriginAirport = Boolean(settings.originAirport);
    const hasFlightCredentials = Boolean(
      settings.flightApi.key && settings.flightApi.host
    );
    const shouldFetchFlights =
      hasDestinationAirport && hasOriginAirport && hasFlightCredentials;
    const shouldFetchTrains = Boolean(settings.sncfApi.key);

    state.travel = {
      distanceKm,
      heuristics,
      scheduleDate: tripDate,
      loadingFlights: shouldFetchFlights,
      loadingTrains: shouldFetchTrains,
      flightOffers: [],
      trainJourneys: [],
      flightError: null,
      trainError: null,
      arrivalStation: null,
    };

    if (!hasDestinationAirport) {
      state.travel.flightError = 'No destination airport configured for this spot.';
    } else if (!hasOriginAirport) {
      state.travel.flightError = 'Set an origin airport code to fetch live flights.';
    } else if (!hasFlightCredentials) {
      state.travel.flightError =
        'Add your Google Flights RapidAPI host and key above to fetch live fares.';
    }

    if (!shouldFetchTrains) {
      state.travel.trainError =
        'Add your SNCF API token above to fetch live rail journeys.';
    }

    refreshSpotCard(spot);

    if (shouldFetchFlights) {
      fetchFlightOffers({
        origin: settings.originAirport,
        destination: spot.airportCode,
        departureDate: tripDate,
      })
        .then((offers) => {
          if (runToken !== updateSequence) return;
          updateSpotState(spot.id, (draft) => {
            if (!draft.travel) return;
            draft.travel.loadingFlights = false;
            draft.travel.flightOffers = offers;
            if (!offers.length) {
              draft.travel.flightError =
                'No flight offers returned for the selected date.';
            } else {
              draft.travel.flightError = null;
            }
          });
        })
        .catch((error) => {
          if (runToken !== updateSequence) return;
          updateSpotState(spot.id, (draft) => {
            if (!draft.travel) return;
            draft.travel.loadingFlights = false;
            draft.travel.flightError = error.message ?? 'Failed to load flight data.';
          });
        });
    }

    if (shouldFetchTrains) {
      fetchSncfJourneys({
        from: userLocation,
        to: spot,
        departureDate: tripDate,
      })
        .then(({ journeys, arrivalStation }) => {
          if (runToken !== updateSequence) return;
          updateSpotState(spot.id, (draft) => {
            if (!draft.travel) return;
            draft.travel.loadingTrains = false;
            draft.travel.trainJourneys = journeys;
            draft.travel.arrivalStation = arrivalStation ?? null;
            if (!journeys.length) {
              draft.travel.trainError =
                'No rail journeys returned for the selected date.';
            } else {
              draft.travel.trainError = null;
            }
          });
        })
        .catch((error) => {
          if (runToken !== updateSequence) return;
          updateSpotState(spot.id, (draft) => {
            if (!draft.travel) return;
            draft.travel.loadingTrains = false;
            draft.travel.arrivalStation = null;
            draft.travel.trainError = error.message ?? 'Failed to load rail journeys.';
          });
        });
    }
  }
}

async function geocode(query) {
  const backendParams = new URLSearchParams({ query });
  try {
    const response = await fetch(`/api/geocode?${backendParams.toString()}`);
    if (response.status === 404) {
      const error = new Error('Geocoding backend not available.');
      error.code = 'BACKEND_MISSING';
      throw error;
    }
    if (!response.ok) {
      const errorPayload = await response.json().catch(async () => ({
        error: await response.text().catch(() => 'Location search failed'),
      }));
      throw new Error(errorPayload.error || 'Location search failed');
    }
    return response.json();
  } catch (error) {
    if (error?.code !== 'BACKEND_MISSING' && error?.name !== 'TypeError') {
      throw error;
    }
    console.warn('Falling back to direct geocoding fetch', error);
  }

  const params = new URLSearchParams({
    name: query,
    count: 1,
    language: 'en',
    format: 'json',
  });
  const response = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error('Location search failed');
  }
  const result = await response.json();
  if (!result?.results?.length) {
    throw new Error('No results found');
  }
  const location = result.results[0];
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    name: `${location.name}, ${location.country_code}`,
  };
}

locateBtn?.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Geolocation is not supported by your browser.', true);
    return;
  }
  setStatus('Locating…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        name: 'your current position',
      };
      setStatus(`Using ${userLocation.name}`);
      updateSpots();
    },
    () => {
      setStatus('Unable to retrieve your location.', true);
    },
    { timeout: 10000 }
  );
});

searchBtn?.addEventListener('click', async () => {
  const query = locationInput.value.trim();
  if (!query) {
    setStatus('Enter a city to search.');
    locationInput.focus();
    return;
  }
  setStatus('Searching location…');
  try {
    const location = await geocode(query);
    userLocation = location;
    setStatus(`Using ${location.name}`);
    updateSpots();
  } catch (error) {
    console.error(error);
    setStatus(error.message ?? 'Could not find that place.', true);
  }
});

locationInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchBtn?.click();
  }
});

originAirportInput?.addEventListener('change', (event) => {
  settings.originAirport = sanitizeAirport(event.target.value);
  originAirportInput.value = settings.originAirport;
  persistSettings();
  if (userLocation) {
    updateSpots();
  }
});

flightHostInput?.addEventListener('change', (event) => {
  settings.flightApi.host = event.target.value.trim();
  persistSettings();
  if (userLocation) {
    updateSpots();
  }
});

flightKeyInput?.addEventListener('change', (event) => {
  settings.flightApi.key = event.target.value.trim();
  persistSettings();
  if (userLocation) {
    updateSpots();
  }
});

sncfKeyInput?.addEventListener('change', (event) => {
  settings.sncfApi.key = event.target.value.trim();
  persistSettings();
  if (userLocation) {
    updateSpots();
  }
});

// render initial placeholder cards
updateSpots();
loadSurfSpotsFromBackend();
