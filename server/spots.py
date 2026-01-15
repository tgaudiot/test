"""Surf spot catalogue limited to French destinations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class SurfSpot:
    """Represents a surf destination with travel metadata."""

    id: str
    name: str
    region: str
    latitude: float
    longitude: float
    airport_code: str


SURF_SPOTS: List[SurfSpot] = [
    SurfSpot(
        id="hossegor",
        name="Hossegor",
        region="Nouvelle-Aquitaine, France",
        latitude=43.663,
        longitude=-1.441,
        airport_code="BIQ",
    ),
    SurfSpot(
        id="cote-des-basques",
        name="Côte des Basques",
        region="Nouvelle-Aquitaine, France",
        latitude=43.478,
        longitude=-1.566,
        airport_code="BIQ",
    ),
    SurfSpot(
        id="lacanau-ocean",
        name="Lacanau Océan",
        region="Nouvelle-Aquitaine, France",
        latitude=44.977,
        longitude=-1.205,
        airport_code="BOD",
    ),
    SurfSpot(
        id="la-torche",
        name="La Torche",
        region="Brittany, France",
        latitude=47.836,
        longitude=-4.372,
        airport_code="BES",
    ),
    SurfSpot(
        id="plage-des-dunes",
        name="Plage des Dunes",
        region="Pays de la Loire, France",
        latitude=46.636,
        longitude=-1.875,
        airport_code="NTE",
    ),
    SurfSpot(
        id="palavas-les-flots",
        name="Palavas-les-Flots",
        region="Occitanie, France",
        latitude=43.528,
        longitude=3.908,
        airport_code="MPL",
    ),
    SurfSpot(
        id="leucate",
        name="Leucate",
        region="Occitanie, France",
        latitude=42.909,
        longitude=3.056,
        airport_code="PGF",
    ),
]


def find_spot_by_id(spot_id: str) -> Optional[SurfSpot]:
    """Return the surf spot that matches ``spot_id`` if present."""

    if not spot_id:
        return None
    normalised = spot_id.strip()
    if not normalised:
        return None
    for spot in SURF_SPOTS:
        if spot.id == normalised:
            return spot
    return None
