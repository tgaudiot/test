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

export function findSpotById(id) {
  if (!id) return null;
  return surfSpots.find((spot) => spot.id === id) ?? null;
}
