# Surf Trip Planner

A lightweight static web app that helps surfers discover upcoming weekend sessions by combining Copernicus Marine forecasts for iconic French spots with estimated travel costs.

## Features

- Fetches marine weather data for a curated list of popular surf spots using the [Copernicus Marine Service](https://marine.copernicus.eu/) API when credentials are available, with an automatic fallback to the Open-Meteo marine endpoint.
- Lets you use your current location or search for a city via the Open-Meteo geocoding service.
- Calculates rough train and flight costs using distance-based heuristics so you can compare travel options quickly, and can
  augment them with live Google Flights and SNCF data when API credentials are provided.
- Responsive design with support for light and dark modes.

## Getting started

The project ships with a lightweight Node.js backend so you can run it as a dynamic web app that proxies external APIs and keeps your credentials off the client. If you prefer, you can still open `web/index.html` directly in a browser or serve the `web` directory with any static web server (for example, `python -m http.server` from within the directory).

### Running the dynamic server

1. Install dependencies (Node.js 18+ is recommended so the server can use the built-in `fetch` API):

   ```bash
   npm install
   ```

2. Provide any API credentials as environment variables (optional if you want to enter them in the UI):

   ```bash
   export COPERNICUS_USERNAME="your-copernicus-username"
   export COPERNICUS_PASSWORD="your-copernicus-password"
   export COPERNICUS_PRODUCT_ID="GLOBAL_ANALYSIS_FORECAST_WAV_001_027-TDS"
   export COPERNICUS_VARIABLES="significant_wave_height,wind_speed,wind_from_direction,sea_surface_temperature"
   export COPERNICUS_POINT_ENDPOINT="https://nrt.cmems-du.eu/api/v1/forecast/point" # optional override
   export COPERNICUS_RANGE_HOURS="96" # optional forecast horizon in hours
   export RAPIDAPI_HOST="google-flights43.p.rapidapi.com"
   export RAPIDAPI_KEY="your-rapidapi-key"
   export SNCF_TOKEN="your-sncf-token"
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Visit <http://localhost:3000> to use the app. The Node backend serves the static assets and exposes `/api` routes that proxy Copernicus Marine, Open-Meteo (as a fallback), Google Flights, and SNCF so the browser never touches those services directly.

The dynamic server is optional&mdash;if it is not running the front-end automatically falls back to the direct browser-based requests used in the original static version.

> **Note:** Browser geolocation requires HTTPS in production environments. When testing locally you may need to enable location access manually.

## Configuring live data APIs

1. Create an account with the [Copernicus Marine Service](https://data.marine.copernicus.eu/register) to obtain your username and password. Optional: choose a different product ID or variable list if you want to work with another model.
2. Sign up for the [Google Flights API on RapidAPI](https://rapidapi.com/apidojo/api/google-flights/) and copy your RapidAPI key and host (for example `google-flights43.p.rapidapi.com`).
3. Request an API token from [api.sncf.com](https://www.digital.sncf.com/startup/api) for access to the SNCF/Navitia journey API.
4. Open the Surf Trip Planner page and locate the **Live data integrations** section at the top.
5. Enter your Copernicus credentials (and optional product/variables), origin airport IATA code, RapidAPI host, RapidAPI key, and SNCF token. The values are stored locally in your browser.
6. Set your location (via the "Use my location" button or by searching for a city) and the app will fetch Copernicus marine forecasts, the next available weekend's flight offers, and rail journeys alongside the heuristic estimates.

If any service is unavailable or returns no offers for the chosen date, the UI displays the error response while keeping the distance-based fallback estimates visible.
