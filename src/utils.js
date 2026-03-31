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
  attraction: 'Sevärdhet',
  monument: 'Monument',
  castle: 'Slott/Borg',
  ruins: 'Ruiner',
  archaeological_site: 'Fornlämning',
  memorial: 'Minnesmärke',
  museum: 'Museum',
  church: 'Kyrka',
  palace: 'Palats',
  fort: 'Fästning',
  city_gate: 'Stadsport',
  manor: 'Herrgård',
  historic: 'Historisk plats',
};

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function geocode(cityName) {
  const url =
    `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(cityName)}&format=json&limit=1&addressdetails=1`;
  const res = await fetch(url, {
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

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];
// Server-side Overpass [timeout:N] caps query processing time (seconds).
// The client-side abort is set higher to leave a margin for network
// transmission after the server has finished processing.
export const OVERPASS_SERVER_TIMEOUT_S = 25;
export const OVERPASS_TIMEOUT_MS = 35000;

export async function fetchNearby(lat, lon, radiusKm, {
  endpoints = OVERPASS_ENDPOINTS,
  serverTimeoutS = OVERPASS_SERVER_TIMEOUT_S,
  clientTimeoutMs = OVERPASS_TIMEOUT_MS,
} = {}) {
  const radiusM = radiusKm * 1000;
  // Query cities/towns/villages/hamlets and notable landmarks within the radius.
  // [timeout:N] caps server-side processing (in seconds); "out center 500" limits
  // the response to 500 elements so that large cities don't produce huge JSON
  // payloads that stall res.json() indefinitely.
  // The historic filter uses an explicit value list to avoid matching very common
  // tags like historic=building/house/farm that would return huge result sets and
  // cause server-side timeouts.
  const HISTORIC_VALUES = 'monument|castle|ruins|archaeological_site|memorial|fort|palace|city_gate|manor|church';
  const query = `
    [out:json][timeout:${serverTimeoutS}];
    (
      node["place"~"^(city|town|village|hamlet)$"](around:${radiusM},${lat},${lon});
      node["tourism"="attraction"]["name"](around:${radiusM},${lat},${lon});
      node["historic"~"^(${HISTORIC_VALUES})$"]["name"](around:${radiusM},${lat},${lon});
      way["tourism"="attraction"]["name"](around:${radiusM},${lat},${lon});
      way["historic"~"^(${HISTORIC_VALUES})$"]["name"](around:${radiusM},${lat},${lon});
    );
    out center 500;
  `;

  const fetchFromEndpoint = async (endpoint, controller) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'HittaStaden/1.0',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Overpass API returnerade ett fel (HTTP ${res.status}).`);
    const data = await res.json();
    return data.elements || [];
  };

  // Retry once after a short delay before surfacing the error to the user,
  // so that a transient overload on all endpoints doesn't immediately fail.
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 2000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // One AbortController per endpoint so we can cancel losers once a winner
    // resolves, and cancel all of them if the overall timeout fires.
    const controllers = endpoints.map(() => new AbortController());
    const timeoutId = setTimeout(() => controllers.forEach(c => c.abort()), clientTimeoutMs);
    try {
      return await Promise.any(
        endpoints.map((endpoint, i) => fetchFromEndpoint(endpoint, controllers[i]))
      );
    } catch {
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    } finally {
      clearTimeout(timeoutId);
      // Cancel any still-running requests (losing endpoints or aborted ones).
      controllers.forEach(c => c.abort());
    }
  }
  throw new Error('Overpass API är inte tillgänglig. Försök igen senare.');
}

/**
 * Processes a raw list of Overpass elements into sorted, enriched place objects.
 *
 * @param {object[]} places       Raw Overpass elements
 * @param {number}   originLat    Origin latitude
 * @param {number}   originLon    Origin longitude
 * @param {string|null} originOsmId  OSM id of the origin (to exclude it from results)
 * @returns {object[]} Sorted array of place objects with id, name, type, category, lat, lon, dist
 */
export function processPlaces(places, originLat, originLon, originOsmId) {
  return places
    .filter(p => {
      if (originOsmId && String(p.id) === originOsmId) return false;
      const name = p.tags && p.tags.name;
      return name && name.trim().length > 0;
    })
    .map(p => {
      // Nodes have lat/lon directly; ways/relations have a center object
      const lat = p.lat ?? p.center?.lat;
      const lon = p.lon ?? p.center?.lon;
      if (lat == null || lon == null) return null;
      const placeType = p.tags.place;
      const tourismType = p.tags.tourism;
      const historicType = p.tags.historic;
      let type, category;
      if (placeType) {
        type = placeType;
        category = 'place';
      } else if (tourismType) {
        type = tourismType;
        category = 'landmark';
      } else {
        type = historicType || 'historic';
        category = 'landmark';
      }
      return {
        id: p.id,
        name: p.tags.name,
        type,
        category,
        lat,
        lon,
        dist: haversine(originLat, originLon, lat, lon),
      };
    })
    .filter(p => p !== null)
    .sort((a, b) => a.dist - b.dist);
}
