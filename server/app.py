"""FastAPI application that powers the Surf Trip Planner backend."""

from __future__ import annotations

import asyncio
import importlib
import inspect
import base64
import json
import math
import os
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Callable, Dict, Mapping, Optional, Sequence, Tuple
from zipfile import ZipFile

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

COPERNICUS_DEFAULT_DATASET_ID = (
    os.getenv("COPERNICUS_DATASET_ID", "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i").strip()
)
COPERNICUS_DEFAULT_PRODUCT_ID = (
    os.getenv("COPERNICUS_PRODUCT_ID", COPERNICUS_DEFAULT_DATASET_ID).strip()
)
COPERNICUS_DEFAULT_ENDPOINT = (
    os.getenv("COPERNICUS_POINT_ENDPOINT", "https://nrt.cmems-du.eu/api/v1/forecast/point").strip()
)
COPERNICUS_DEFAULT_VARIABLES = [
    part.strip()
    for part in (os.getenv("COPERNICUS_VARIABLES", "").split(","))
    if part.strip()
]
COPERNICUS_DEFAULT_RANGE_HOURS = float(os.getenv("COPERNICUS_RANGE_HOURS", "96") or 96)
COPERNICUS_SUBSET_TIMEOUT_SECONDS = float(
    os.getenv("COPERNICUS_SUBSET_TIMEOUT_SECONDS", "120") or 120
)
COPERNICUS_USERNAME = os.getenv("COPERNICUS_USERNAME", "").strip()
COPERNICUS_PASSWORD = os.getenv("COPERNICUS_PASSWORD", "").strip()

COPERNICUS_LAT_MIN = -80.0
COPERNICUS_LAT_MAX = 90.0
COPERNICUS_LON_MIN = -180.0
COPERNICUS_LON_MAX = 179.91666666666666
COPERNICUS_SUBSET_PADDING = 0.125

COPERNICUS_FALLBACK_VARIABLES = [
    "significant_wave_height",
    "wind_speed",
    "wind_from_direction",
    "sea_surface_temperature",
]

COPERNICUS_VARIABLE_ALIASES = {
    "significant_wave_height": ["VHM0", "SWH"],
    "wave_height": ["VHM0", "SWH"],
    "wave": ["VHM0", "SWH"],
    "wind_speed": ["WSPD", "WIND"],
    "wind_speed_10m": ["WSPD"],
    "wind_from_direction": ["VMDR", "MWD"],
    "sea_surface_temperature": ["WTMP", "SST"],
    "sea_water_temperature": ["WTMP", "SST"],
    "temperature": ["WTMP", "SST"],
    "sea_temperature": ["WTMP", "SST"],
    "peak_wave_period": ["VTPK", "VTM10", "MWP"],
}


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
    dataset_id = str(requested.get("datasetId", "")).strip()
    if not dataset_id:
        dataset_id = str(requested.get("productId", "")).strip()
    product_id = dataset_id or COPERNICUS_DEFAULT_PRODUCT_ID or COPERNICUS_DEFAULT_DATASET_ID
    endpoint = str(requested.get("pointUrl", "")).strip() or COPERNICUS_DEFAULT_ENDPOINT
    variables = _parse_variables(
        requested.get("variables") if requested.get("variables") else COPERNICUS_DEFAULT_VARIABLES
    )
    try:
        range_candidate = float(requested.get("rangeHours", COPERNICUS_DEFAULT_RANGE_HOURS))
    except (TypeError, ValueError):
        range_candidate = COPERNICUS_DEFAULT_RANGE_HOURS
    range_hours = range_candidate if range_candidate > 0 else COPERNICUS_DEFAULT_RANGE_HOURS

    try:
        timeout_candidate = float(
            requested.get("timeoutSeconds", COPERNICUS_SUBSET_TIMEOUT_SECONDS)
        )
    except (TypeError, ValueError):
        timeout_candidate = COPERNICUS_SUBSET_TIMEOUT_SECONDS
    timeout_seconds = (
        timeout_candidate if timeout_candidate > 0 else COPERNICUS_SUBSET_TIMEOUT_SECONDS
    )

    return {
        "username": username,
        "password": password,
        "productId": product_id,
        "datasetId": product_id,
        "endpoint": endpoint,
        "variables": variables or list(COPERNICUS_FALLBACK_VARIABLES),
        "rangeHours": range_hours,
        "timeoutSeconds": timeout_seconds,
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


def _resolve_subset_variables(requested: Sequence[str]) -> list[str]:
    resolved: list[str] = []
    seen: set[str] = set()

    iterable: Sequence[str]
    if isinstance(requested, str):
        iterable = [requested]
    else:
        iterable = requested

    for raw in iterable:
        text = str(raw).strip()
        if not text:
            continue
        lower = text.lower()
        aliases = COPERNICUS_VARIABLE_ALIASES.get(lower)
        if aliases:
            for alias in aliases:
                candidate = alias.strip().upper()
                if candidate and candidate not in seen:
                    seen.add(candidate)
                    resolved.append(candidate)
            continue
        candidate = text.upper()
        if candidate and candidate not in seen:
            seen.add(candidate)
            resolved.append(candidate)

    if not resolved:
        for fallback in ("VHM0", "VTPK", "VMDR"):
            if fallback not in seen:
                seen.add(fallback)
                resolved.append(fallback)

    return resolved


def _resolve_copernicus_subset_callable(module: Any) -> Callable[..., Any]:
    candidate = getattr(module, "subset", None)
    if callable(candidate):
        return candidate

    if candidate is not None and hasattr(candidate, "__call__"):
        return candidate  # type: ignore[return-value]

    subset_spec = importlib.util.find_spec("copernicusmarine.subset")
    if subset_spec is not None:
        subset_module = importlib.import_module("copernicusmarine.subset")
        if callable(subset_module):
            return subset_module  # type: ignore[return-value]

        module_candidate = getattr(subset_module, "subset", None)
        if callable(module_candidate):
            return module_candidate

        if module_candidate is not None and hasattr(module_candidate, "__call__"):
            return module_candidate  # type: ignore[return-value]

    raise AttributeError(
        "copernicusmarine subset callable is unavailable; ensure the client package is up to date."
    )


def _resolve_copernicus_login_callable(module: Any) -> Optional[Callable[..., Any]]:
    search_modules: list[Any] = [module]
    for module_name in ("copernicusmarine.subset", "copernicusmarine.credentials"):
        spec = importlib.util.find_spec(module_name)
        if spec is None:
            continue
        try:
            search_modules.append(importlib.import_module(module_name))
        except ModuleNotFoundError:
            continue

    for candidate_module in search_modules:
        for attribute in ("login", "Login"):
            candidate = getattr(candidate_module, attribute, None)
            if callable(candidate):
                return candidate

    return None


def _invoke_copernicus_login(
    *,
    login_callable: Callable[..., Any],
    username: str,
    password: str,
) -> None:
    try:
        signature = inspect.signature(login_callable)
    except (TypeError, ValueError):
        signature = None

    call_kwargs: Dict[str, Any] = {}
    if signature:
        params = signature.parameters
        if "username" in params:
            call_kwargs["username"] = username
        elif "user" in params:
            call_kwargs["user"] = username
        elif "login" in params:
            call_kwargs["login"] = username

        if "password" in params:
            call_kwargs["password"] = password
        elif "passwd" in params:
            call_kwargs["passwd"] = password
        elif "pwd" in params:
            call_kwargs["pwd"] = password

        for flag in ("overwrite", "force", "save"):
            if flag in params:
                call_kwargs[flag] = True

        for optional in ("show_progress", "progress"):
            if optional in params and optional not in call_kwargs:
                call_kwargs[optional] = False

    if not call_kwargs:
        call_kwargs = {"username": username, "password": password}

    try:
        result = login_callable(**call_kwargs)
    except TypeError:
        result = login_callable(username, password)

    if isinstance(result, Mapping):
        status = str(result.get("status") or result.get("result") or "").lower()
        if status and status not in {"ok", "success", "succeeded"}:
            message = result.get("message") or result.get("detail") or result
            raise RuntimeError(f"Copernicus login failed: {message}")
    elif isinstance(result, bool) and not result:
        raise RuntimeError("Copernicus login failed: credentials were rejected.")
    elif isinstance(result, str) and "invalid" in result.lower():
        raise RuntimeError(f"Copernicus login failed: {result}")


def _collect_subset_paths(result: Any) -> list[Path]:
    paths: list[Path] = []
    visited: set[int] = set()

    def _walk(value: Any) -> None:
        if value is None:
            return
        identifier = id(value)
        if identifier in visited:
            return
        visited.add(identifier)

        if isinstance(value, (str, os.PathLike)):
            candidate = Path(value)
            if candidate.exists():
                paths.append(candidate)
            return

        if isinstance(value, Mapping):
            for item in value.values():
                _walk(item)
            return

        if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            for item in value:
                _walk(item)
            return

        for attr in (
            "output_path",
            "output_file_path",
            "output_filename",
            "path",
            "filepath",
            "subset_path",
        ):
            if hasattr(value, attr):
                _walk(getattr(value, attr))

    _walk(result)
    return paths


def _convert_time_axis(time_array: Any) -> list[str]:
    import numpy as np
    from netCDF4 import num2date

    values = getattr(time_array, "values", time_array)
    attrs = getattr(time_array, "attrs", {}) or {}
    encoding = getattr(time_array, "encoding", {}) or {}

    array = np.asanyarray(values)
    if hasattr(array, "filled"):
        array = array.filled(np.nan)

    iso: list[str] = []
    if array.size == 0:
        return iso

    if np.issubdtype(array.dtype, np.datetime64):
        for item in array:
            iso.append(np.datetime_as_string(item, unit="s"))
        return iso

    for item in array:
        if isinstance(item, datetime):
            iso.append(item.isoformat())
    if iso:
        return iso

    units = attrs.get("units") or encoding.get("units")
    if not units:
        return iso
    calendar = attrs.get("calendar") or encoding.get("calendar") or "standard"

    for item in array:
        try:
            dt = num2date(item, units, calendar=calendar)
        except Exception:
            continue
        if isinstance(dt, datetime):
            iso.append(dt.isoformat())
        else:
            iso.append(str(dt))

    return iso


def _to_numeric_series(values: Any) -> list[Optional[float]]:
    import numpy as np

    array = np.asanyarray(values)
    if hasattr(array, "filled"):
        array = array.filled(np.nan)

    flattened = array.reshape(-1)
    series: list[Optional[float]] = []
    for item in flattened:
        if item is None:
            series.append(None)
            continue
        try:
            numeric = float(item)
        except (TypeError, ValueError):
            numeric = float("nan")
        series.append(numeric if math.isfinite(numeric) else None)

    return series


def _subset_copernicus_dataset(
    latitude: float,
    longitude: float,
    config: Mapping[str, Any],
) -> Dict[str, Any]:
    import copernicusmarine
    import xarray as xr

    dataset_id = str(config.get("datasetId") or config.get("productId") or "").strip()
    if not dataset_id:
        raise ValueError("Copernicus dataset ID is required.")

    variables = _resolve_subset_variables(config.get("variables", []))

    try:
        horizon_hours = float(config.get("rangeHours", 96))
    except (TypeError, ValueError):
        horizon_hours = 96.0
    if horizon_hours <= 0:
        horizon_hours = 96.0

    start_time = datetime.utcnow()
    end_time = start_time + timedelta(hours=horizon_hours)

    pad = COPERNICUS_SUBSET_PADDING
    lat = max(COPERNICUS_LAT_MIN, min(COPERNICUS_LAT_MAX, float(latitude)))
    lon = max(COPERNICUS_LON_MIN, min(COPERNICUS_LON_MAX, float(longitude)))
    min_lat = max(COPERNICUS_LAT_MIN, lat - pad)
    max_lat = min(COPERNICUS_LAT_MAX, lat + pad)
    min_lon = max(COPERNICUS_LON_MIN, lon - pad)
    max_lon = min(COPERNICUS_LON_MAX, lon + pad)

    with TemporaryDirectory() as tmpdir:
        subset_kwargs = {
            "dataset_id": dataset_id,
            "variables": variables,
            "minimum_longitude": float(min_lon),
            "maximum_longitude": float(max_lon),
            "minimum_latitude": float(min_lat),
            "maximum_latitude": float(max_lat),
            "start_datetime": start_time.replace(microsecond=0).isoformat(),
            "end_datetime": end_time.replace(microsecond=0).isoformat(),
            "output_directory": tmpdir,
            "overwrite": True,
            "show_progress": False,
        }

        username = str(config.get("username", "")).strip()
        password = str(config.get("password", "")).strip()
        if username:
            subset_kwargs["username"] = username
        if password:
            subset_kwargs["password"] = password

        subset_callable = _resolve_copernicus_subset_callable(copernicusmarine)

        login_callable = _resolve_copernicus_login_callable(copernicusmarine)
        if username and password and login_callable:
            try:
                _invoke_copernicus_login(
                    login_callable=login_callable,
                    username=username,
                    password=password,
                )
            except Exception as exc:
                message = str(exc)
                lowered = message.lower()
                if lowered.startswith("copernicus login failed"):
                    raise RuntimeError(message) from exc
                raise RuntimeError(f"Copernicus login failed: {message}") from exc

        def _invoke_subset(kwargs: Dict[str, Any]) -> Any:
            call_kwargs = dict(kwargs)
            try:
                return subset_callable(**call_kwargs)
            except TypeError:
                call_kwargs.pop("username", None)
                call_kwargs.pop("password", None)
                return subset_callable(**call_kwargs)

        def _raise_if_invalid_credentials(error: Exception) -> None:
            message = str(error)
            if "invalid credential" in message.lower():
                raise RuntimeError(
                    "Copernicus login failed: Invalid credentials provided."
                ) from error

        try:
            subset_result = _invoke_subset(subset_kwargs)
        except Exception as exc:
            _raise_if_invalid_credentials(exc)
            fallback_vars = [var for var in ("VHM0", "VTPK", "VMDR") if var in variables]
            if not fallback_vars:
                fallback_vars = ["VHM0", "VTPK", "VMDR"]
            subset_kwargs["variables"] = fallback_vars
            try:
                subset_result = _invoke_subset(subset_kwargs)
            except Exception as second_exc:
                _raise_if_invalid_credentials(second_exc)
                raise exc
            else:
                variables = list(fallback_vars)

        root = Path(tmpdir)
        candidates = [path for path in _collect_subset_paths(subset_result) if path.exists()]

        dataset_path: Optional[Path] = None
        for candidate in candidates:
            if candidate.suffix.lower() == ".nc" and candidate.exists():
                dataset_path = candidate
                break

        if dataset_path is None:
            nc_paths = list(root.rglob("*.nc"))
            if nc_paths:
                dataset_path = nc_paths[0]

        if dataset_path is None:
            archives = [path for path in candidates if path.suffix.lower() == ".zip" and path.exists()]
            if not archives:
                archives = list(root.rglob("*.zip"))
            for archive_path in archives:
                extract_root = root / "extracted"
                extract_root.mkdir(exist_ok=True)
                with ZipFile(archive_path) as archive:
                    names = [name for name in archive.namelist() if name.lower().endswith(".nc")]
                    if not names:
                        continue
                    extracted = Path(archive.extract(names[0], path=extract_root))
                    dataset_path = extracted
                    break

        if dataset_path is None or not dataset_path.exists():
            raise RuntimeError("Copernicus subset did not produce a NetCDF dataset.")

        payload_variables: Dict[str, Any] = {}

        with xr.open_dataset(dataset_path) as dataset:
            dataset.load()
            time_key: Optional[str] = None
            for candidate in ("time", "TIME"):
                if candidate in dataset.variables:
                    time_key = candidate
                    break
            if time_key is None:
                for coord_name in dataset.coords:
                    if "time" in coord_name.lower():
                        time_key = coord_name
                        break
            if time_key is None:
                raise RuntimeError("Copernicus dataset does not include a time coordinate.")

            time_array = dataset[time_key]
            iso_times = _convert_time_axis(time_array)
            if not iso_times:
                raise RuntimeError("Unable to parse Copernicus time axis.")

            desired = {name.lower() for name in variables}

            for name, data_array in dataset.data_vars.items():
                if name.lower() not in desired:
                    continue
                collapsed = data_array
                for dim in tuple(collapsed.dims):
                    if dim == time_key:
                        continue
                    collapsed = collapsed.isel({dim: 0})
                collapsed = collapsed.squeeze(drop=True)
                series = _to_numeric_series(collapsed.to_numpy())
                if not series or len(series) != len(iso_times):
                    continue
                payload_variables[name] = {
                    "time": list(iso_times),
                    "values": series,
                }

        if not payload_variables:
            raise RuntimeError("Copernicus dataset did not contain the requested variables.")

    return normalise_copernicus_forecast({"variables": payload_variables})


async def _fetch_copernicus_forecast(
    *,
    latitude: float,
    longitude: float,
    config: Mapping[str, Any],
) -> Dict[str, Any]:
    if not config.get("username") or not config.get("password"):
        raise ValueError("Copernicus credentials are missing.")

    try:
        timeout_candidate = float(config.get("timeoutSeconds", 0))
    except (TypeError, ValueError):
        timeout_candidate = 0
    timeout_seconds = (
        timeout_candidate if timeout_candidate and timeout_candidate > 0 else COPERNICUS_SUBSET_TIMEOUT_SECONDS
    )

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_subset_copernicus_dataset, latitude, longitude, config),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        raise TimeoutError(
            f"Copernicus forecast request exceeded the {timeout_seconds:.0f}-second timeout."
        ) from exc


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
