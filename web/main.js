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
const copernicusUsernameInput = document.querySelector('#copernicus-username-input');
const copernicusPasswordInput = document.querySelector('#copernicus-password-input');
const copernicusProductInput = document.querySelector('#copernicus-product-input');
const copernicusVariablesInput = document.querySelector('#copernicus-variables-input');
const copernicusEndpointInput = document.querySelector('#copernicus-endpoint-input');
const copernicusHoursInput = document.querySelector('#copernicus-hours-input');

const COPERNICUS_DEFAULT_POINT_URL = 'https://nrt.cmems-du.eu/api/v1/forecast/point';
const COPERNICUS_DEFAULT_PRODUCT_ID = 'GLOBAL_ANALYSIS_FORECAST_WAV_001_027-TDS';
const COPERNICUS_DEFAULT_VARIABLES = [
  'significant_wave_height',
  'wind_speed',
  'wind_from_direction',
  'sea_surface_temperature',
];
const COPERNICUS_DEFAULT_RANGE_HOURS = 96;

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
    id: 'cote-des-basques',
    name: 'Côte des Basques',
    region: 'Nouvelle-Aquitaine, France',
    latitude: 43.478,
    longitude: -1.566,
    airportCode: 'BIQ',
  },
  {
    id: 'lacanau-ocean',
    name: 'Lacanau Océan',
    region: 'Nouvelle-Aquitaine, France',
    latitude: 44.977,
    longitude: -1.205,
    airportCode: 'BOD',
  },
  {
    id: 'la-torche',
    name: 'La Torche',
    region: 'Brittany, France',
    latitude: 47.836,
    longitude: -4.372,
    airportCode: 'BES',
  },
  {
    id: 'plage-des-dunes',
    name: 'Plage des Dunes',
    region: 'Pays de la Loire, France',
    latitude: 46.636,
    longitude: -1.875,
    airportCode: 'NTE',
  },
  {
    id: 'palavas-les-flots',
    name: 'Palavas-les-Flots',
    region: 'Occitanie, France',
    latitude: 43.528,
    longitude: 3.908,
    airportCode: 'MPL',
  },
  {
    id: 'leucate',
    name: 'Leucate',
    region: 'Occitanie, France',
    latitude: 42.909,
    longitude: 3.056,
    airportCode: 'PGF',
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
  copernicusApi: {
    username: '',
    password: '',
    productId: COPERNICUS_DEFAULT_PRODUCT_ID,
    variables: COPERNICUS_DEFAULT_VARIABLES.join(','),
    pointUrl: COPERNICUS_DEFAULT_POINT_URL,
    rangeHours: COPERNICUS_DEFAULT_RANGE_HOURS,
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
      copernicusApi: {
        username: parsed?.copernicusApi?.username ?? defaultSettings.copernicusApi.username,
        password: parsed?.copernicusApi?.password ?? defaultSettings.copernicusApi.password,
        productId: parsed?.copernicusApi?.productId ?? defaultSettings.copernicusApi.productId,
        variables: parsed?.copernicusApi?.variables ?? defaultSettings.copernicusApi.variables,
        pointUrl: parsed?.copernicusApi?.pointUrl ?? defaultSettings.copernicusApi.pointUrl,
        rangeHours: Number.isFinite(Number(parsed?.copernicusApi?.rangeHours))
          ? Number(parsed.copernicusApi.rangeHours)
          : defaultSettings.copernicusApi.rangeHours,
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
  if (copernicusUsernameInput) {
    copernicusUsernameInput.value = settings.copernicusApi.username;
  }
  if (copernicusPasswordInput) {
    copernicusPasswordInput.value = settings.copernicusApi.password;
  }
  if (copernicusProductInput) {
    copernicusProductInput.value = settings.copernicusApi.productId;
  }
  if (copernicusVariablesInput) {
    copernicusVariablesInput.value = settings.copernicusApi.variables;
  }
  if (copernicusEndpointInput) {
    copernicusEndpointInput.value = settings.copernicusApi.pointUrl;
  }
  if (copernicusHoursInput) {
    copernicusHoursInput.value = settings.copernicusApi.rangeHours;
  }
}

applySettingsToInputs();

function parseCopernicusVariables(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : `${item}`.trim()))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function buildCopernicusConfig() {
  const config = settings?.copernicusApi ?? defaultSettings.copernicusApi;
  const username = config?.username?.trim?.() || '';
  const password = config?.password?.trim?.() || '';
  const productId = config?.productId?.trim?.() || COPERNICUS_DEFAULT_PRODUCT_ID;
  const pointUrl = config?.pointUrl?.trim?.() || COPERNICUS_DEFAULT_POINT_URL;
  const variablesList = parseCopernicusVariables(config?.variables);
  const rangeCandidate = Number.parseFloat(config?.rangeHours);
  const rangeHours = Number.isFinite(rangeCandidate) && rangeCandidate > 0
    ? rangeCandidate
    : COPERNICUS_DEFAULT_RANGE_HOURS;

  return {
    username,
    password,
    productId,
    pointUrl,
    variables: variablesList.length ? variablesList : [...COPERNICUS_DEFAULT_VARIABLES],
    rangeHours,
  };
}

function copernicusValueToNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapCopernicusValue(key, value) {
  const numeric = copernicusValueToNumber(value);
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
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{8}T\d{6}$/.test(trimmed)) {
      const iso = `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T${trimmed.slice(9, 11)}:${trimmed.slice(
        11,
        13
      )}:${trimmed.slice(13)}`;
      const parsed = new Date(iso);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function ensureCopernicusRecord(map, isoTime) {
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
    const timeCandidate =
      times[index]?.time ?? times[index]?.datetime ?? times[index]?.date ?? times[index]?.timestamp ?? times[index];
    const isoTime = coerceCopernicusTime(timeCandidate);
    if (!isoTime) continue;

    const rawValue = values[index]?.value ?? values[index];
    const { key, value } = mapCopernicusValue(name, rawValue);
    if (!key) continue;

    const record = ensureCopernicusRecord(map, isoTime);
    record[key] = value;
  }
}

function consumeCopernicusArray(map, entry) {
  if (!entry) return;
  const time =
    entry?.time ?? entry?.datetime ?? entry?.date ?? entry?.timestamp ?? entry?.t ?? entry?.Time ?? entry?.TIME ?? null;
  const isoTime = coerceCopernicusTime(time);
  if (!isoTime) return;

  const record = ensureCopernicusRecord(map, isoTime);
  Object.entries(entry).forEach(([name, value]) => {
    if (['time', 'datetime', 'date', 'timestamp', 't', 'Time', 'TIME'].includes(name)) return;
    const { key, value: numeric } = mapCopernicusValue(name, value);
    if (key) {
      record[key] = numeric;
    }
  });
}

function normaliseCopernicusPayload(payload) {
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

async function fetchCopernicusForecastDirect(spot, config) {
  if (!config?.username || !config?.password) {
    throw new Error('Missing Copernicus credentials.');
  }

  const url = new URL(config.pointUrl || COPERNICUS_DEFAULT_POINT_URL);
  url.searchParams.set('latitude', spot.latitude.toString());
  url.searchParams.set('longitude', spot.longitude.toString());
  if (config.productId) {
    url.searchParams.set('product_id', config.productId);
  }
  if (Array.isArray(config.variables) && config.variables.length) {
    url.searchParams.set('variables', config.variables.join(','));
  }
  const range = Number.isFinite(config.rangeHours) && config.rangeHours > 0 ? config.rangeHours : COPERNICUS_DEFAULT_RANGE_HOURS;
  const start = new Date();
  const end = new Date(start.getTime() + range * 60 * 60 * 1000);
  url.searchParams.set('start_datetime', start.toISOString());
  url.searchParams.set('end_datetime', end.toISOString());
  url.searchParams.set('temporal_resolution', 'PT1H');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const label = `${response.status} ${response.statusText}`.trim();
    throw new Error(
      text
        ? `Copernicus forecast failed: ${text.slice(0, 120)}`
        : `Copernicus forecast failed: ${label}`
    );
  }

  const payload = await response.json();
  const normalised = normaliseCopernicusPayload(payload);
  if (!normalised?.hourly?.time?.length) {
    throw new Error('Copernicus forecast did not return any data.');
  }
  return normalised;
}

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
  const copernicusConfig = buildCopernicusConfig();
  const hasCopernicusCredentials = Boolean(copernicusConfig.username && copernicusConfig.password);

  const backendPayload = {
    spotId: spot.id ?? '',
    latitude: spot.latitude,
    longitude: spot.longitude,
  };

  if (hasCopernicusCredentials) {
    backendPayload.copernicus = {
      username: copernicusConfig.username,
      password: copernicusConfig.password,
      productId: copernicusConfig.productId,
      variables: copernicusConfig.variables.join(','),
      pointUrl: copernicusConfig.pointUrl,
      rangeHours: copernicusConfig.rangeHours,
    };
  }

  let copernicusFallbackError = null;

  try {
    const backendResponse = await fetch('/api/forecast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendPayload),
    });

    if (backendResponse.status === 404) {
      const error = new Error('Forecast backend not available.');
      error.code = 'BACKEND_MISSING';
      throw error;
    }

    if (backendResponse.ok) {
      return backendResponse.json();
    }

    const errorPayload = await backendResponse.json().catch(async () => ({
      error: await backendResponse.text().catch(() => 'Forecast request failed'),
    }));
    throw new Error(errorPayload.error || 'Unable to fetch forecast data');
  } catch (error) {
    if (error?.code !== 'BACKEND_MISSING' && error?.name !== 'TypeError') {
      throw error;
    }
    console.warn('Forecast backend unavailable, attempting client-side fallback', error);
  }

  if (hasCopernicusCredentials) {
    try {
      return await fetchCopernicusForecastDirect(spot, copernicusConfig);
    } catch (error) {
      copernicusFallbackError = error;
      console.warn('Copernicus forecast failed, falling back to Open-Meteo', error);
    }
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
    const text = await response.text().catch(() => '');
    if (copernicusFallbackError) {
      throw new Error(
        `Copernicus and Open-Meteo requests failed. ${copernicusFallbackError.message || ''} ${text.slice(0, 120)}`.trim()
      );
    }
    throw new Error('Unable to fetch forecast data');
  }

  const payload = await response.json();
  const meta = payload && typeof payload.meta === 'object' && !Array.isArray(payload.meta) ? payload.meta : {};
  if (copernicusFallbackError) {
    payload.meta = {
      ...meta,
      fallback: 'open-meteo',
      copernicusError: copernicusFallbackError.message ?? 'Copernicus forecast failed.',
    };
    payload.source = payload.source || 'open-meteo-fallback';
  } else if (meta !== payload.meta) {
    payload.meta = meta;
    payload.source = payload.source || 'open-meteo';
  } else {
    payload.source = payload.source || 'open-meteo';
  }

  return payload;
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
      wave: Number.isFinite(wave_height?.[index]) ? wave_height[index] : null,
      wind: Number.isFinite(wind_speed_10m?.[index]) ? wind_speed_10m[index] : null,
      windDir: Number.isFinite(wind_direction_10m?.[index]) ? wind_direction_10m[index] : null,
      temp: Number.isFinite(temperature_2m?.[index]) ? temperature_2m[index] : null,
    });
  });

  Object.entries(byDay)
    .slice(0, 3)
    .forEach(([key, values]) => {
      const displayDate = new Date(key);
      const average = values.reduce(
        (acc, value) => {
          if (Number.isFinite(value.wave)) {
            acc.wave += value.wave;
            acc.waveCount += 1;
          }
          if (Number.isFinite(value.wind)) {
            acc.wind += value.wind;
            acc.windCount += 1;
          }
          if (Number.isFinite(value.windDir)) {
            acc.windDir += value.windDir;
            acc.windDirCount += 1;
          }
          if (Number.isFinite(value.temp)) {
            acc.temp += value.temp;
            acc.tempCount += 1;
          }
          return acc;
        },
        { wave: 0, waveCount: 0, wind: 0, windCount: 0, windDir: 0, windDirCount: 0, temp: 0, tempCount: 0 }
      );

      summary.push({
        date: displayDate.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        wave: average.waveCount ? average.wave / average.waveCount : null,
        wind: average.windCount ? average.wind / average.windCount : null,
        windDir: average.windDirCount ? average.windDir / average.windDirCount : null,
        temp: average.tempCount ? average.temp / average.tempCount : null,
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
      const waveLabel = Number.isFinite(entry.wave) ? `${entry.wave.toFixed(1)} m` : '–';
      const windSpeedLabel = Number.isFinite(entry.wind) ? `${entry.wind.toFixed(1)} m/s` : null;
      const windDirLabel = Number.isFinite(entry.windDir) ? `${entry.windDir.toFixed(0)}°` : null;
      let windLabel = '–';
      if (windSpeedLabel && windDirLabel) {
        windLabel = `${windSpeedLabel} (${windDirLabel})`;
      } else if (windSpeedLabel) {
        windLabel = windSpeedLabel;
      } else if (windDirLabel) {
        windLabel = windDirLabel;
      }
      const tempLabel = Number.isFinite(entry.temp) ? `${entry.temp.toFixed(0)} °C` : '–';
      p.innerHTML = `<strong>${entry.date}</strong> · Wave ${waveLabel} · Wind ${windLabel} · Temp ${tempLabel}`;
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

copernicusUsernameInput?.addEventListener('change', (event) => {
  settings.copernicusApi.username = event.target.value.trim();
  persistSettings();
  updateSpots();
});

copernicusPasswordInput?.addEventListener('change', (event) => {
  settings.copernicusApi.password = event.target.value.trim();
  persistSettings();
  updateSpots();
});

copernicusProductInput?.addEventListener('change', (event) => {
  settings.copernicusApi.productId = event.target.value.trim() || COPERNICUS_DEFAULT_PRODUCT_ID;
  copernicusProductInput.value = settings.copernicusApi.productId;
  persistSettings();
  updateSpots();
});

copernicusVariablesInput?.addEventListener('change', (event) => {
  settings.copernicusApi.variables = event.target.value.trim();
  persistSettings();
  updateSpots();
});

copernicusEndpointInput?.addEventListener('change', (event) => {
  settings.copernicusApi.pointUrl = event.target.value.trim() || COPERNICUS_DEFAULT_POINT_URL;
  copernicusEndpointInput.value = settings.copernicusApi.pointUrl;
  persistSettings();
  updateSpots();
});

copernicusHoursInput?.addEventListener('change', (event) => {
  const value = Number.parseFloat(event.target.value);
  const sanitised = Number.isFinite(value) && value > 0 ? value : COPERNICUS_DEFAULT_RANGE_HOURS;
  settings.copernicusApi.rangeHours = sanitised;
  copernicusHoursInput.value = sanitised;
  persistSettings();
  updateSpots();
});

// render initial placeholder cards
updateSpots();
loadSurfSpotsFromBackend();
