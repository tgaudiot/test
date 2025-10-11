# Surf Trip Planner

A lightweight static web app that helps surfers discover upcoming weekend sessions by combining marine forecasts for iconic European spots with estimated travel costs.

## Features

- Fetches marine weather data for a curated list of popular surf spots using the [Open-Meteo Marine API](https://open-meteo.com/).
- Lets you use your current location or search for a city via the Open-Meteo geocoding service.
- Calculates rough train and flight costs using distance-based heuristics so you can compare travel options quickly, and can
  augment them with live Google Flights and SNCF data when API credentials are provided.
- Responsive design with support for light and dark modes.

## Getting started

The project is fully static, so you can open `web/index.html` directly in a browser or serve the `web` directory with any static web server (for example, `python -m http.server` from within the directory).

> **Note:** Browser geolocation requires HTTPS in production environments. When testing locally you may need to enable location access manually.

## Connecting live travel APIs

1. Sign up for the [Google Flights API on RapidAPI](https://rapidapi.com/apidojo/api/google-flights/) and copy your RapidAPI key and host (for example `google-flights43.p.rapidapi.com`).
2. Request an API token from [api.sncf.com](https://www.digital.sncf.com/startup/api) for access to the SNCF/Navitia journey API.
3. Open the Surf Trip Planner page and locate the **Live travel integrations** section at the top.
4. Enter your origin airport IATA code, RapidAPI host, RapidAPI key, and SNCF token. The values are stored locally in your browser.
5. Set your location (via the "Use my location" button or by searching for a city) and the app will fetch the next available weekend's flight offers and rail journeys alongside the heuristic estimates.

If either service is unavailable or returns no offers for the chosen date, the UI will display the error response while keeping the distance-based fallback estimates visible.
