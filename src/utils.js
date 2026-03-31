/** Haversine formula – returns distance in km between two lat/lon points */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(km) {
  return km < 1
    ? `${Math.round(km * 1000)} m`
    : `${km.toFixed(1)} km`;
}

export const PLACE_TYPE_LABELS = {
  city: 'Stad',
  town: 'Tätort',
  village: 'Ort',
  hamlet: 'Ort',
};

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchWithRetry(url, options = {}, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

export async function geocode(cityName) {
  const url =
    `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(cityName)}&format=json&limit=1&addressdetails=1`;
  const res = await fetchWithRetry(url, {
    headers: {
      'Accept-Language': 'sv,en',
      'User-Agent': 'HittaStaden/1.0',
    }
  });
  if (!res.ok) throw new Error(`Nominatim returnerade ett fel (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data.length) throw new Error(`Kunde inte hitta "${cityName}". Försök med ett annat namn.`);
  return data[0];
}

export const GEONAMES_DATASET_URL =
  'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/' +
  'geonames-all-cities-with-a-population-1000/records';
export const FETCH_TIMEOUT_MS = 10_000;

export async function fetchNearby(lat, lon, radiusKm, {
  datasetUrl = GEONAMES_DATASET_URL,
  timeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  const where = `within_distance(coordinates, geom'POINT(${lon} ${lat})', ${radiusKm}km)`;
  const select = 'name,coordinates,population,country_code';
  const url =
    `${datasetUrl}?where=${encodeURIComponent(where)}` +
    `&limit=100` +
    `&select=${encodeURIComponent(select)}` +
    `&order_by=${encodeURIComponent('population DESC')}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'HittaStaden/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GeoNames-data returnerade ett fel (HTTP ${res.status}).`);
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Sökningen tog för lång tid. Försök igen senare.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Processes a raw list of GeoNames city records into sorted, enriched place objects.
 *
 * @param {object[]} places       Raw records from the GeoNames cities dataset
 * @param {number}   originLat    Origin latitude
 * @param {number}   originLon    Origin longitude
 * @param {string|null} originName  Display name of the origin city (to exclude it from results)
 * @returns {object[]} Sorted array of place objects with name, type, category, lat, lon, population, dist
 */
export function processPlaces(places, originLat, originLon, originName) {
  return places
    .filter(p => {
      const name = p.name;
      if (!name || !name.trim()) return false;
      if (originName && name === originName) return false;
      const coords = p.coordinates;
      return coords && coords.lat != null && coords.lon != null;
    })
    .map(p => {
      const lat = p.coordinates.lat;
      const lon = p.coordinates.lon;
      const population = p.population || 0;
      let type;
      if (population >= 50_000) type = 'city';
      else if (population >= 10_000) type = 'town';
      else type = 'village';
      return {
        name: p.name,
        type,
        category: 'place',
        lat,
        lon,
        population,
        dist: haversine(originLat, originLon, lat, lon),
      };
    })
    .sort((a, b) => a.dist - b.dist);
}
