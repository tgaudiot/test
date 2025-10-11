import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { surfSpots, findSpotById } from './spots.js';
import {
  normaliseFlightOffers,
  normaliseSncfJourneys,
  formatFlightDate,
  formatSncfDatetime,
} from './normalisers.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.join(__dirname, '..', 'web');

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date?.getTime?.()) ? null : date;
}

app.get('/api/spots', (req, res) => {
  res.json({ spots: surfSpots });
});

app.get('/api/geocode', async (req, res) => {
  const query = (req.query.query ?? '').toString().trim();
  if (!query) {
    res.status(400).json({ error: 'Query is required.' });
    return;
  }
  const params = new URLSearchParams({
    name: query,
    count: '1',
    language: 'en',
    format: 'json',
  });
  try {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      res.status(response.status).json({
        error: `Geocoding failed: ${response.status} ${response.statusText}`,
        details: text.slice(0, 200),
      });
      return;
    }
    const payload = await response.json();
    if (!payload?.results?.length) {
      res.status(404).json({ error: 'No results found.' });
      return;
    }
    const location = payload.results[0];
    res.json({
      latitude: location.latitude,
      longitude: location.longitude,
      name: `${location.name}, ${location.country_code}`,
    });
  } catch (error) {
    res.status(502).json({ error: 'Geocoding lookup failed.', details: error.message });
  }
});

app.get('/api/forecast', async (req, res) => {
  const { spotId } = req.query;
  let latitude = Number.parseFloat(req.query.lat);
  let longitude = Number.parseFloat(req.query.lon);
  if (spotId) {
    const spot = findSpotById(spotId.toString());
    if (spot) {
      latitude = spot.latitude;
      longitude = spot.longitude;
    }
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    res.status(400).json({ error: 'Latitude and longitude are required.' });
    return;
  }
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    hourly: 'wave_height,wind_speed_10m,wind_direction_10m,temperature_2m',
    daily: 'wave_height_max,swell_height_max,swell_direction_dominant',
    timezone: 'auto',
  });
  try {
    const response = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      res.status(response.status).json({
        error: `Forecast request failed: ${response.status} ${response.statusText}`,
        details: text.slice(0, 200),
      });
      return;
    }
    const payload = await response.json();
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: 'Forecast lookup failed.', details: error.message });
  }
});

app.post('/api/flights', async (req, res) => {
  const origin = (req.body?.origin ?? '').toString().toUpperCase();
  const destination = (req.body?.destination ?? '').toString().toUpperCase();
  const departureDate = parseDate(req.body?.departureDate);
  const host = req.body?.rapidApi?.host?.trim?.() || process.env.RAPIDAPI_HOST || '';
  const key = req.body?.rapidApi?.key?.trim?.() || process.env.RAPIDAPI_KEY || '';

  if (!origin || !destination || !departureDate) {
    res.status(400).json({ error: 'Origin, destination and departureDate are required.' });
    return;
  }
  if (!host || !key) {
    res.status(400).json({ error: 'RapidAPI host and key are required to fetch flights.' });
    return;
  }

  try {
    const url = new URL(`https://${host.replace(/^https?:\/\//i, '')}/search`);
    url.searchParams.set('from', origin);
    url.searchParams.set('to', destination);
    url.searchParams.set('departure', formatFlightDate(departureDate));
    url.searchParams.set('currency', 'EUR');
    url.searchParams.set('adults', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': host,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      res.status(response.status).json({
        error: `Flights request failed: ${response.status} ${response.statusText}`,
        details: text.slice(0, 200),
      });
      return;
    }
    const payload = await response.json();
    res.json({ offers: normaliseFlightOffers(payload) });
  } catch (error) {
    res.status(502).json({ error: 'Flights lookup failed.', details: error.message });
  }
});

app.post('/api/trains', async (req, res) => {
  const from = req.body?.from ?? {};
  const to = req.body?.to ?? {};
  const departureDate = parseDate(req.body?.departureDate);
  const token = req.body?.sncf?.key?.trim?.() || process.env.SNCF_TOKEN || '';

  if (!Number.isFinite(from.latitude) || !Number.isFinite(from.longitude)) {
    res.status(400).json({ error: 'From latitude and longitude are required.' });
    return;
  }
  if (!Number.isFinite(to.latitude) || !Number.isFinite(to.longitude)) {
    res.status(400).json({ error: 'To latitude and longitude are required.' });
    return;
  }
  if (!departureDate) {
    res.status(400).json({ error: 'Departure date is required.' });
    return;
  }
  if (!token) {
    res.status(400).json({ error: 'SNCF API token is required to fetch rail journeys.' });
    return;
  }

  try {
    const url = new URL('https://api.sncf.com/v1/coverage/sncf/journeys');
    url.searchParams.set('from', `${from.longitude};${from.latitude}`);
    url.searchParams.set('to', `${to.longitude};${to.latitude}`);
    url.searchParams.set('datetime', formatSncfDatetime(departureDate));
    url.searchParams.set('datetime_represents', 'departure');
    url.searchParams.set('count', '3');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`,
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
          // Ignore JSON parse errors – we'll fall back to the raw snippet below.
        }
      }
      res.status(response.status).json({
        error: friendlyMessage
          ? `Rail request failed: ${friendlyMessage}`
          : `Rail request failed: ${fallbackLabel}`,
        details: friendlyMessage || text.slice(0, 200) || fallbackLabel,
      });
      return;
    }
    const payload = await response.json();
    res.json({ journeys: normaliseSncfJourneys(payload) });
  } catch (error) {
    res.status(502).json({ error: 'Rail lookup failed.', details: error.message });
  }
});

app.use(express.static(webDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(webDir, 'index.html'));
});

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
if (!Number.isFinite(port)) {
  throw new Error('Invalid PORT value provided.');
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Surf Trip Planner server listening on http://localhost:${port}`);
  });
}

export default app;
