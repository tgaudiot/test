export const surfSpots = [
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

export function findSpotById(id) {
  if (!id) return null;
  return surfSpots.find((spot) => spot.id === id) ?? null;
}
