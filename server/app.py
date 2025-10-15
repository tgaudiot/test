"""FastAPI application that powers the Surf Trip Planner backend."""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Tuple

import httpx
from fastapi import Body, FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .normalisers import (
    format_flight_date,
    format_sncf_datetime,
    normalise_copernicus_forecast,
    normalise_flight_offers,
    normalise_sncf_journeys,
)
from .spots import SURF_SPOTS, find_spot_by_id

app = FastAPI(title="Surf Trip Planner API")

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

COPERNICUS_DEFAULT_ENDPOINT = (
    os.getenv("COPERNICUS_POINT_ENDPOINT", "https://nrt.cmems-du.eu/api/v1/forecast/point").strip()
)
COPERNICUS_DEFAULT_PRODUCT_ID = (
    os.getenv("COPERNICUS_PRODUCT_ID", "GLOBAL_ANALYSIS_FORECAST_WAV_001_027-TDS").strip()
)
COPERNICUS_DEFAULT_VARIABLES = [
    part.strip()
    for part in (os.getenv("COPERNICUS_VARIABLES", "").split(","))
    if part.strip()
]
COPERNICUS_DEFAULT_RANGE_HOURS = float(os.getenv("COPERNICUS_RANGE_HOURS", "96") or 96)
COPERNICUS_USERNAME = os.getenv("COPERNICUS_USERNAME", "").strip()
COPERNICUS_PASSWORD = os.getenv("COPERNICUS_PASSWORD", "").strip()

COPERNICUS_FALLBACK_VARIABLES = [
    "significant_wave_height",
    "wind_speed",
    "wind_from_direction",
    "sea_surface_temperature",
]


def _parse_variables(value: Any) -> list[str]:
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def _resolve_copernicus_config(requested: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    requested = requested or {}
    username = str(requested.get("username", "")).strip() or COPERNICUS_USERNAME
    password = str(requested.get("password", "")).strip() or COPERNICUS_PASSWORD
    product_id = str(requested.get("productId", "")).strip() or COPERNICUS_DEFAULT_PRODUCT_ID
    endpoint = str(requested.get("pointUrl", "")).strip() or COPERNICUS_DEFAULT_ENDPOINT
    variables = _parse_variables(
        requested.get("variables") if requested.get("variables") else COPERNICUS_DEFAULT_VARIABLES
    )
    try:
        range_candidate = float(requested.get("rangeHours", COPERNICUS_DEFAULT_RANGE_HOURS))
    except (TypeError, ValueError):
        range_candidate = COPERNICUS_DEFAULT_RANGE_HOURS
    range_hours = range_candidate if range_candidate > 0 else COPERNICUS_DEFAULT_RANGE_HOURS

    return {
        "username": username,
        "password": password,
        "productId": product_id,
        "endpoint": endpoint,
        "variables": variables or list(COPERNICUS_FALLBACK_VARIABLES),
        "rangeHours": range_hours,
    }


def _coerce_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed != parsed:  # NaN check
        return None
    return parsed


def _truncate(text: str, limit: int = 200) -> str:
    return text if len(text) <= limit else text[:limit]


def _extract_coordinates(source: Mapping[str, Any], spot_id: Optional[str]) -> Tuple[Optional[float], Optional[float]]:
    latitude = _coerce_float(source.get("lat") or source.get("latitude"))
    longitude = _coerce_float(source.get("lon") or source.get("longitude"))

    candidate_spot = find_spot_by_id(spot_id or source.get("spotId") or "")
    if candidate_spot:
        latitude = candidate_spot.latitude
        longitude = candidate_spot.longitude

    return latitude, longitude


async def _fetch_copernicus_forecast(
    *,
    latitude: float,
    longitude: float,
    config: Mapping[str, Any],
) -> Dict[str, Any]:
    if not config.get("username") or not config.get("password"):
        raise ValueError("Copernicus credentials are missing.")

    params = {
        "latitude": str(latitude),
        "longitude": str(longitude),
        "product_id": config.get("productId"),
        "variables": ",".join(config.get("variables", [])),
        "temporal_resolution": "PT1H",
    }

    horizon = config.get("rangeHours", 96)
    try:
        horizon_hours = float(horizon)
    except (TypeError, ValueError):
        horizon_hours = 96.0
    if horizon_hours <= 0:
        horizon_hours = 96.0

    start_time = datetime.utcnow()
    end_time = start_time + timedelta(hours=horizon_hours)
    params["start_datetime"] = start_time.isoformat()
    params["end_datetime"] = end_time.isoformat()

    headers = {
        "Authorization": "Basic "
        + base64.b64encode(f"{config['username']}:{config['password']}".encode()).decode(),
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            config.get("endpoint", COPERNICUS_DEFAULT_ENDPOINT),
            params={key: value for key, value in params.items() if value},
            headers=headers,
        )

    if response.status_code >= 400:
        snippet = _truncate(response.text or f"{response.status_code} {response.reason_phrase}")
        raise RuntimeError(f"Copernicus forecast failed: {snippet}")

    payload = response.json()
    normalised = normalise_copernicus_forecast(payload)
    hourly = normalised.get("hourly", {})
    if not hourly or not hourly.get("time"):
        raise RuntimeError("Copernicus forecast did not return any time series data.")
    return normalised


def _parse_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value))
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                continue
    return None


async def _find_nearest_stop_area(
    *,
    latitude: float,
    longitude: float,
    token: str,
    role: str,
) -> Optional[Dict[str, Any]]:
    params = {
        "type[]": "stop_area",
        "count": "1",
        "distance": "20000",
    }
    url = f"https://api.sncf.com/v1/coverage/sncf/coords/{longitude};{latitude}/places_nearby"
    headers = {
        "Authorization": "Basic " + base64.b64encode(f"{token}:".encode()).decode(),
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, params=params, headers=headers)

    if response.status_code >= 400:
        snippet = _truncate(response.text or f"{response.status_code} {response.reason_phrase}")
        raise RuntimeError(f"Failed to find {role} SNCF station: {snippet}")

    payload = response.json()
    places = payload.get("places_nearby") if isinstance(payload, Mapping) else None
    if isinstance(places, list):
        for place in places:
            if (
                isinstance(place, Mapping)
                and place.get("embedded_type") == "stop_area"
                and isinstance(place.get("stop_area"), Mapping)
            ):
                stop_area = place["stop_area"]
                return {
                    "id": stop_area.get("id"),
                    "name": stop_area.get("name") or stop_area.get("label") or "Unknown station",
                    "label": stop_area.get("label") or stop_area.get("name") or stop_area.get("id"),
                    "distanceMeters": place.get("distance"),
                }
    return None


@app.get("/api/spots")
def list_spots() -> Dict[str, Any]:
    return {"spots": [spot.__dict__ for spot in SURF_SPOTS]}


@app.get("/api/geocode")
async def geocode(query: str = Query(..., min_length=1)) -> Dict[str, Any]:
    params = {
        "name": query,
        "count": "1",
        "language": "en",
        "format": "json",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get("https://geocoding-api.open-meteo.com/v1/search", params=params)

    if response.status_code >= 400:
        snippet = _truncate(response.text or f"{response.status_code} {response.reason_phrase}")
        return JSONResponse(
            {
                "error": f"Geocoding failed: {response.status_code} {response.reason_phrase}",
                "details": snippet,
            },
            status_code=response.status_code,
        )

    payload = response.json()
    results = payload.get("results") if isinstance(payload, Mapping) else None
    if not results:
        return JSONResponse({"error": "No results found."}, status_code=404)

    location = results[0]
    return {
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "name": f"{location.get('name')}, {location.get('country_code')}",
    }


async def _handle_forecast(
    *,
    latitude: Optional[float],
    longitude: Optional[float],
    copernicus_config: Optional[Mapping[str, Any]],
) -> JSONResponse:
    if latitude is None or longitude is None:
        return JSONResponse({"error": "Latitude and longitude are required."}, status_code=400)

    config = _resolve_copernicus_config(copernicus_config)
    has_credentials = bool(config.get("username") and config.get("password"))
    copernicus_error: Optional[Exception] = None

    if has_credentials:
        try:
            payload = await _fetch_copernicus_forecast(
                latitude=latitude, longitude=longitude, config=config
            )
            return JSONResponse(payload)
        except Exception as exc:  # pragma: no cover - logging side-effect only
            copernicus_error = exc
            print("Copernicus forecast failed", exc)

    params = {
        "latitude": str(latitude),
        "longitude": str(longitude),
        "hourly": "wave_height,wind_speed_10m,wind_direction_10m,temperature_2m",
        "daily": "wave_height_max,swell_height_max,swell_direction_dominant",
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get("https://marine-api.open-meteo.com/v1/marine", params=params)
    except httpx.HTTPError as exc:
        details = (
            f"{exc}. Copernicus fallback error: {copernicus_error}" if copernicus_error else str(exc)
        )
        return JSONResponse({"error": "Forecast lookup failed.", "details": details}, status_code=502)

    if response.status_code >= 400:
        snippet = _truncate(response.text or f"{response.status_code} {response.reason_phrase}")
        if copernicus_error:
            return JSONResponse(
                {
                    "error": "Copernicus and Open-Meteo forecast requests failed.",
                    "details": f"{copernicus_error} | Open-Meteo: {snippet}",
                },
                status_code=response.status_code,
            )
        return JSONResponse(
            {
                "error": f"Forecast request failed: {response.status_code} {response.reason_phrase}",
                "details": snippet,
            },
            status_code=response.status_code,
        )

    payload = response.json()
    meta = payload.get("meta") if isinstance(payload.get("meta"), Mapping) else {}
    if copernicus_error:
        payload["meta"] = {
            **meta,
            "fallback": "open-meteo",
            "copernicusError": str(copernicus_error),
        }
        payload["source"] = payload.get("source") or "open-meteo-fallback"
    else:
        payload["meta"] = dict(meta)
        payload["source"] = payload.get("source") or "open-meteo"
    return JSONResponse(payload)


@app.get("/api/forecast")
async def get_forecast(
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    spotId: Optional[str] = Query(None),
) -> JSONResponse:
    latitude, longitude = _extract_coordinates({"lat": lat, "lon": lon}, spotId)
    return await _handle_forecast(latitude=latitude, longitude=longitude, copernicus_config=None)


@app.post("/api/forecast")
async def post_forecast(payload: Mapping[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    spot_id = payload.get("spotId") if isinstance(payload, Mapping) else None
    latitude, longitude = _extract_coordinates(payload, spot_id if isinstance(spot_id, str) else None)
    config = payload.get("copernicus") if isinstance(payload, Mapping) else None
    return await _handle_forecast(latitude=latitude, longitude=longitude, copernicus_config=config)


@app.post("/api/flights")
async def flights(payload: Mapping[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    origin = str(payload.get("origin", "")).upper()
    destination = str(payload.get("destination", "")).upper()
    departure_date = _parse_datetime(payload.get("departureDate"))
    rapid_api = payload.get("rapidApi") if isinstance(payload.get("rapidApi"), Mapping) else {}
    host = str(rapid_api.get("host", "")).strip() or os.getenv("RAPIDAPI_HOST", "").strip()
    key = str(rapid_api.get("key", "")).strip() or os.getenv("RAPIDAPI_KEY", "").strip()

    if not origin or not destination or not departure_date:
        return JSONResponse(
            {"error": "Origin, destination and departureDate are required."}, status_code=400
        )
    if not host or not key:
        return JSONResponse(
            {"error": "RapidAPI host and key are required to fetch flights."}, status_code=400
        )

    clean_host = host
    if clean_host.startswith("https://"):
        clean_host = clean_host[8:]
    if clean_host.startswith("http://"):
        clean_host = clean_host[7:]
    url = f"https://{clean_host}/search"
    params = {
        "from": origin,
        "to": destination,
        "departure": format_flight_date(departure_date),
        "currency": "EUR",
        "adults": "1",
    }
    headers = {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": host,
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, params=params, headers=headers)

    if response.status_code >= 400:
        snippet = _truncate(response.text or f"{response.status_code} {response.reason_phrase}")
        return JSONResponse(
            {
                "error": f"Flights request failed: {response.status_code} {response.reason_phrase}",
                "details": snippet,
            },
            status_code=response.status_code,
        )

    payload = response.json()
    return JSONResponse({"offers": normalise_flight_offers(payload)})


@app.post("/api/trains")
async def trains(payload: Mapping[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    origin = payload.get("from") if isinstance(payload.get("from"), Mapping) else {}
    destination = payload.get("to") if isinstance(payload.get("to"), Mapping) else {}
    departure_date = _parse_datetime(payload.get("departureDate"))
    sncf = payload.get("sncf") if isinstance(payload.get("sncf"), Mapping) else {}
    token = str(sncf.get("key", "")).strip() or os.getenv("SNCF_TOKEN", "").strip()

    origin_lat = _coerce_float(origin.get("latitude"))
    origin_lon = _coerce_float(origin.get("longitude"))
    destination_lat = _coerce_float(destination.get("latitude"))
    destination_lon = _coerce_float(destination.get("longitude"))

    if origin_lat is None or origin_lon is None:
        return JSONResponse({"error": "From latitude and longitude are required."}, status_code=400)
    if destination_lat is None or destination_lon is None:
        return JSONResponse({"error": "To latitude and longitude are required."}, status_code=400)
    if not departure_date:
        return JSONResponse({"error": "Departure date is required."}, status_code=400)
    if not token:
        return JSONResponse(
            {"error": "SNCF API token is required to fetch rail journeys."}, status_code=400
        )

    try:
        arrival_station = await _find_nearest_stop_area(
            latitude=destination_lat,
            longitude=destination_lon,
            token=token,
            role="destination",
        )
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)

    if not arrival_station:
        return JSONResponse(
            {"error": "No SNCF station found near the destination location."}, status_code=404
        )

    try:
        origin_station = await _find_nearest_stop_area(
            latitude=origin_lat,
            longitude=origin_lon,
            token=token,
            role="origin",
        )
    except Exception:
        origin_station = None

    params = {
        "from": origin_station["id"] if origin_station else f"{origin_lon};{origin_lat}",
        "to": arrival_station["id"],
        "datetime": format_sncf_datetime(departure_date),
        "datetime_represents": "departure",
        "count": "3",
    }
    headers = {
        "Authorization": "Basic " + base64.b64encode(f"{token}:".encode()).decode(),
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            "https://api.sncf.com/v1/coverage/sncf/journeys", params=params, headers=headers
        )

    if response.status_code >= 400:
        snippet = response.text
        friendly = ""
        if snippet:
            try:
                payload = response.json()
                friendly = payload.get("error", {}).get("message", "") if isinstance(payload, Mapping) else ""
            except json.JSONDecodeError:
                friendly = ""
        message = (
            f"Rail request failed: {friendly}" if friendly else f"Rail request failed: {response.status_code} {response.reason_phrase}"
        )
        details = friendly or _truncate(snippet or "", 200)
        return JSONResponse({"error": message, "details": details}, status_code=response.status_code)

    payload = response.json()
    return JSONResponse(
        {
            "journeys": normalise_sncf_journeys(payload),
            "arrivalStation": arrival_station,
            "originStation": origin_station,
        }
    )


app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
