"""Helpers that massage external API payloads into UI-friendly structures."""

from __future__ import annotations

import datetime as _dt
import math
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple


def _parse_iso_duration(value: Any) -> Optional[int]:
    """Return the number of minutes represented by ``value`` if possible."""

    if isinstance(value, (int, float)) and math.isfinite(value):
        return int(value)
    if not isinstance(value, str):
        return None

    trimmed = value.strip()
    if not trimmed:
        return None

    if trimmed.startswith("P"):
        match = re.search(r"PT(?:(\d+)H)?(?:(\d+)M)?", trimmed)
        if match:
            hours = int(match.group(1) or 0)
            minutes = int(match.group(2) or 0)
            return hours * 60 + minutes
    if trimmed.isdigit():
        return int(trimmed)
    return None


def normalise_flight_offers(raw: Any) -> List[Dict[str, Any]]:
    """Convert heterogeneous flight offer payloads into a stable shape."""

    candidates: Iterable[Any]
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes, bytearray)):
        candidates = raw
    else:
        for key in ("data", "trips", "results", "best_flights"):
            value = raw.get(key) if isinstance(raw, Mapping) else None
            if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
                candidates = value
                break
        else:
            candidates = []

    offers: List[Dict[str, Any]] = []
    for item in candidates:
        if not isinstance(item, Mapping):
            continue
        legs = item.get("legs") if isinstance(item.get("legs"), Sequence) else None
        first_leg = None
        if legs:
            first_leg = legs[0] if legs else None
        elif isinstance(item.get("leg"), Mapping):
            first_leg = item["leg"]

        price_raw = None
        price_fields = (
            ("price", "amount"),
            ("price", "value"),
            ("price",),
            ("fare",),
        )
        for path in price_fields:
            cursor: Any = item
            for part in path:
                if isinstance(cursor, Mapping) and part in cursor:
                    cursor = cursor[part]
                else:
                    cursor = None
                    break
            if isinstance(cursor, (int, float)) and math.isfinite(cursor):
                price_raw = float(cursor)
                break
        if price_raw is None:
            sale_total = item.get("saleTotal") if isinstance(item.get("saleTotal"), str) else None
            if sale_total:
                match = re.match(r"^([A-Z]{3})(\d+(?:\.\d+)?)", sale_total)
                if match:
                    price_raw = float(match.group(2))

        if price_raw is None:
            continue

        currency = (
            item.get("price", {}).get("currency")
            if isinstance(item.get("price"), Mapping)
            else item.get("currency")
        )
        if not isinstance(currency, str) and isinstance(item.get("saleTotal"), str):
            currency = item["saleTotal"][:3]
        if not isinstance(currency, str):
            currency = "EUR"

        duration_minutes = _parse_iso_duration(item.get("duration"))
        if duration_minutes is None:
            duration_minutes = _parse_iso_duration(item.get("travelDuration"))
        if duration_minutes is None:
            duration_minutes = _parse_iso_duration(item.get("duration_mins"))
        if duration_minutes is None and isinstance(first_leg, Mapping):
            duration_minutes = _parse_iso_duration(first_leg.get("duration"))

        def _extract_time(keys: Sequence[str], source: Mapping[str, Any]) -> Optional[Any]:
            for key in keys:
                value = source.get(key)
                if value is not None:
                    return value
            return None

        departure = None
        arrival = None
        if isinstance(item, Mapping):
            departure = _extract_time(["departure", "departure_time"], item)
            arrival = _extract_time(["arrival", "arrival_time"], item)
        if isinstance(first_leg, Mapping):
            departure = departure or _extract_time(["departure", "departure_time", "departureTime"], first_leg)
            arrival = arrival or _extract_time(["arrival", "arrival_time", "arrivalTime"], first_leg)

        airline = None
        if isinstance(item.get("airline"), str):
            airline = item["airline"]
        elif isinstance(item.get("carrier"), str):
            airline = item["carrier"]
        elif isinstance(first_leg, Mapping) and isinstance(first_leg.get("airline"), str):
            airline = first_leg["airline"]
        elif isinstance(item.get("airlines"), Sequence):
            airline = ", ".join(str(part) for part in item["airlines"] if isinstance(part, str)) or None

        offers.append(
            {
                "price": round(float(price_raw), 2),
                "currency": currency,
                "durationMinutes": duration_minutes,
                "departure": departure,
                "arrival": arrival,
                "airline": airline,
            }
        )

        if len(offers) >= 3:
            break

    return offers


def normalise_sncf_journeys(raw: Mapping[str, Any]) -> List[Dict[str, Any]]:
    journeys = raw.get("journeys") if isinstance(raw, Mapping) else None
    if not isinstance(journeys, Sequence):
        journeys = []
    results: List[Dict[str, Any]] = []
    for journey in journeys[:3]:
        if not isinstance(journey, Mapping):
            continue
        results.append(
            {
                "durationSeconds": journey.get("duration"),
                "departureDateTime": journey.get("departure_date_time"),
                "arrivalDateTime": journey.get("arrival_date_time"),
                "price": journey.get("fare", {}).get("total") if isinstance(journey.get("fare"), Mapping) else None,
                "currency": journey.get("fare", {}).get("currency") if isinstance(journey.get("fare"), Mapping) else "EUR",
                "transfers": journey.get("nb_transfers"),
            }
        )
    return results


def format_flight_date(date: _dt.datetime) -> str:
    return date.strftime("%Y-%m-%d")


def _pad(value: int) -> str:
    return f"{value:02d}"


def format_sncf_datetime(date: _dt.datetime) -> str:
    return f"{date.year}{_pad(date.month)}{_pad(date.day)}T{_pad(date.hour)}{_pad(date.minute)}00"


def _to_number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
        except (TypeError, ValueError):
            return None
        if math.isfinite(parsed):
            return parsed
    return None


def _normalise_copernicus_value(key: str, value: Any) -> Tuple[Optional[str], Optional[float]]:
    numeric = _to_number(value)
    if numeric is None:
        return None, None

    lowered = key.lower()
    if (
        "significant_wave_height" in lowered
        or lowered in {"vhm0", "wave_height", "swh"}
    ):
        return "wave", numeric
    if "wind_speed" in lowered or lowered in {"ff", "uwnd", "vwnd"}:
        return "wind", numeric
    if "wind_from_direction" in lowered or "wind_direction" in lowered or lowered == "vmdr":
        return "windDir", numeric
    if (
        "sea_surface_temperature" in lowered
        or "sea_water_temperature" in lowered
        or lowered in {"sst", "temperature"}
    ):
        adjusted = numeric - 273.15 if numeric > 200 else numeric
        return "temp", adjusted
    return None, None


def _coerce_copernicus_time(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        return value.isoformat()
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return None
        if re.fullmatch(r"\d{8}T\d{6}", trimmed):
            iso = f"{trimmed[:4]}-{trimmed[4:6]}-{trimmed[6:8]}T{trimmed[9:11]}:{trimmed[11:13]}:{trimmed[13:]}"
            try:
                parsed = _dt.datetime.fromisoformat(iso)
            except ValueError:
                return None
            return parsed.isoformat()
        try:
            parsed = _dt.datetime.fromisoformat(trimmed.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed.isoformat()
    return None


@dataclass
class _CopernicusRecord:
    time: str
    wave: Optional[float] = None
    wind: Optional[float] = None
    windDir: Optional[float] = None
    temp: Optional[float] = None


def _ensure_record(store: MutableMapping[str, _CopernicusRecord], iso_time: str) -> _CopernicusRecord:
    record = store.get(iso_time)
    if record is None:
        record = _CopernicusRecord(time=iso_time)
        store[iso_time] = record
    return record


def _consume_copernicus_variable(
    store: MutableMapping[str, _CopernicusRecord],
    name: str,
    descriptor: Any,
) -> None:
    if descriptor is None:
        return

    if isinstance(descriptor, Mapping):
        times = None
        for key in ("time", "times", "datetime", "dates", "timestamps", "records"):
            value = descriptor.get(key)
            if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
                times = value
                break
        values = None
        for key in ("value", "values", "data"):
            value = descriptor.get(key)
            if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
                values = value
                break
        if times and values:
            for idx in range(min(len(times), len(values))):
                time_candidate = times[idx]
                if isinstance(time_candidate, Mapping):
                    time_candidate = (
                        time_candidate.get("time")
                        or time_candidate.get("datetime")
                        or time_candidate.get("date")
                    )
                iso_time = _coerce_copernicus_time(time_candidate)
                if not iso_time:
                    continue
                raw_value = values[idx]
                if isinstance(raw_value, Mapping):
                    raw_value = raw_value.get("value")
                key_name, numeric = _normalise_copernicus_value(name, raw_value)
                if key_name:
                    record = _ensure_record(store, iso_time)
                    setattr(record, key_name, numeric)
        return

    if isinstance(descriptor, Sequence) and not isinstance(descriptor, (str, bytes, bytearray)):
        for entry in descriptor:
            _consume_copernicus_array(store, entry)


def _consume_copernicus_array(
    store: MutableMapping[str, _CopernicusRecord],
    entry: Any,
) -> None:
    if not isinstance(entry, Mapping):
        return
    time_candidate = (
        entry.get("time")
        or entry.get("datetime")
        or entry.get("date")
        or entry.get("timestamp")
        or entry.get("t")
        or entry.get("Time")
        or entry.get("TIME")
    )
    iso_time = _coerce_copernicus_time(time_candidate)
    if not iso_time:
        return

    record = _ensure_record(store, iso_time)
    for key, value in entry.items():
        if key in {"time", "datetime", "date", "timestamp", "t"}:
            continue
        key_name, numeric = _normalise_copernicus_value(key, value)
        if key_name:
            setattr(record, key_name, numeric)


def normalise_copernicus_forecast(payload: Mapping[str, Any]) -> Dict[str, Any]:
    store: Dict[str, _CopernicusRecord] = {}

    if isinstance(payload.get("data"), Sequence):
        for entry in payload["data"]:
            _consume_copernicus_array(store, entry)

    if isinstance(payload.get("records"), Sequence):
        for entry in payload["records"]:
            _consume_copernicus_array(store, entry)

    variables = payload.get("variables") if isinstance(payload, Mapping) else None
    if isinstance(variables, Mapping):
        for name, descriptor in variables.items():
            _consume_copernicus_variable(store, name, descriptor)

    result = payload.get("result") if isinstance(payload, Mapping) else None
    if isinstance(result, Mapping):
        for name, descriptor in result.items():
            _consume_copernicus_variable(store, name, descriptor)

    entries = sorted(store.values(), key=lambda item: item.time)

    time: List[str] = []
    wave: List[Optional[float]] = []
    wind: List[Optional[float]] = []
    wind_dir: List[Optional[float]] = []
    temp: List[Optional[float]] = []

    for entry in entries:
        timestamp = _coerce_copernicus_time(entry.time)
        if not timestamp:
            continue
        time.append(timestamp)
        wave.append(entry.wave if entry.wave is not None else None)
        wind.append(entry.wind if entry.wind is not None else None)
        wind_dir.append(entry.windDir if entry.windDir is not None else None)
        temp.append(entry.temp if entry.temp is not None else None)

    return {
        "source": "copernicus",
        "hourly": {
            "time": time,
            "wave_height": wave,
            "wind_speed_10m": wind,
            "wind_direction_10m": wind_dir,
            "temperature_2m": temp,
        },
    }
