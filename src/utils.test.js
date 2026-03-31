import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  haversine,
  formatDistance,
  escapeHtml,
  PLACE_TYPE_LABELS,
  GEONAMES_DATASET_URL,
  FETCH_TIMEOUT_MS,
  geocode,
  fetchNearby,
  processPlaces,
} from './utils.js';

// ---------------------------------------------------------------------------
// haversine
// ---------------------------------------------------------------------------
describe('haversine', () => {
  it('returns 0 for the same point', () => {
    expect(haversine(59.33, 18.07, 59.33, 18.07)).toBe(0);
  });

  it('returns the approximate distance between Stockholm and Göteborg (~400 km)', () => {
    // Stockholm: 59.33°N, 18.07°E  |  Göteborg: 57.71°N, 11.97°E
    const dist = haversine(59.33, 18.07, 57.71, 11.97);
    expect(dist).toBeGreaterThan(390);
    expect(dist).toBeLessThan(410);
  });

  it('returns the approximate distance between Stockholm and Malmö (~513 km)', () => {
    // Malmö: 55.60°N, 13.00°E
    const dist = haversine(59.33, 18.07, 55.60, 13.00);
    expect(dist).toBeGreaterThan(505);
    expect(dist).toBeLessThan(525);
  });

  it('is symmetric (A→B equals B→A)', () => {
    const ab = haversine(59.33, 18.07, 57.71, 11.97);
    const ba = haversine(57.71, 11.97, 59.33, 18.07);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('returns a positive distance for distinct points', () => {
    expect(haversine(0, 0, 1, 1)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatDistance
// ---------------------------------------------------------------------------
describe('formatDistance', () => {
  it('shows rounded meters for distances under 1 km', () => {
    expect(formatDistance(0.5)).toBe('500 m');
    expect(formatDistance(0.123)).toBe('123 m');
  });

  it('shows one decimal km for distances of exactly 1 km', () => {
    expect(formatDistance(1)).toBe('1.0 km');
  });

  it('shows one decimal km for distances above 1 km', () => {
    expect(formatDistance(12.3456)).toBe('12.3 km');
    expect(formatDistance(400)).toBe('400.0 km');
  });

  it('rounds meters correctly', () => {
    expect(formatDistance(0.9999)).toBe('1000 m');
    expect(formatDistance(0.0004)).toBe('0 m');
  });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
describe('escapeHtml', () => {
  it('escapes ampersand &', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than <', () => {
    expect(escapeHtml('<')).toBe('&lt;');
  });

  it('escapes greater-than >', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double-quote "', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it("escapes single-quote '", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });

  it('escapes multiple special characters in one string', () => {
    expect(escapeHtml('<a href="test">it\'s & fun</a>')).toBe(
      '&lt;a href=&quot;test&quot;&gt;it&#39;s &amp; fun&lt;/a&gt;'
    );
  });
});

// ---------------------------------------------------------------------------
// PLACE_TYPE_LABELS
// ---------------------------------------------------------------------------
describe('PLACE_TYPE_LABELS', () => {
  it('contains all expected place type keys', () => {
    const expectedKeys = ['city', 'town', 'village', 'hamlet'];
    for (const key of expectedKeys) {
      expect(PLACE_TYPE_LABELS).toHaveProperty(key);
    }
  });

  it('has Swedish labels for common types', () => {
    expect(PLACE_TYPE_LABELS.city).toBe('Stad');
    expect(PLACE_TYPE_LABELS.town).toBe('Tätort');
    expect(PLACE_TYPE_LABELS.village).toBe('Ort');
  });
});

// ---------------------------------------------------------------------------
// GEONAMES_DATASET_URL / FETCH_TIMEOUT_MS
// ---------------------------------------------------------------------------
describe('GeoNames constants', () => {
  it('has a valid dataset URL', () => {
    expect(GEONAMES_DATASET_URL).toContain('opendatasoft.com');
    expect(GEONAMES_DATASET_URL).toContain('geonames');
  });

  it('has a reasonable fetch timeout', () => {
    expect(FETCH_TIMEOUT_MS).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// geocode  (uses mocked fetch)
// ---------------------------------------------------------------------------
describe('geocode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a geocode result from Photon on success', async () => {
    const mockPhotonResponse = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [18.0686, 59.3293] },
        properties: { name: 'Stockholm', county: 'Stockholms län', country: 'Sverige' },
      }],
    };
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockPhotonResponse,
    });

    const result = await geocode('Stockholm');
    expect(result).toEqual({
      lat: '59.3293',
      lon: '18.0686',
      display_name: 'Stockholm, Stockholms län, Sverige',
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('Stockholm');
    expect(url).toContain('photon.komoot.io');
  });

  it('throws a descriptive error when city is not found', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ type: 'FeatureCollection', features: [] }),
    });

    await expect(geocode('XYZBogusCity')).rejects.toThrow(
      'Kunde inte hitta "XYZBogusCity". Försök med ett annat namn.'
    );
  });

  it('throws on HTTP error from geocoder', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(geocode('Stockholm')).rejects.toThrow(
      'Geocoding returnerade ett fel (HTTP 500).'
    );
  });

  it('builds display_name from available properties', async () => {
    const mockResponse = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [11.97, 57.71] },
        properties: { name: 'Göteborg', country: 'Sverige' },
      }],
    };
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await geocode('Göteborg');
    expect(result.display_name).toBe('Göteborg, Sverige');
  });
});

// ---------------------------------------------------------------------------
// fetchNearby  (uses mocked fetch)
// ---------------------------------------------------------------------------
describe('fetchNearby', () => {
  const TEST_DATASET_URL = 'https://test.example.com/api/records';
  const TEST_OPTS = {
    datasetUrl: TEST_DATASET_URL,
    timeoutMs: 60000,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns results from the GeoNames dataset', async () => {
    const results = [
      { name: 'Sollentuna', coordinates: { lat: 59.43, lon: 17.95 }, population: 70000 },
    ];
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results }),
    });

    const result = await fetchNearby(59.33, 18.07, 50, TEST_OPTS);
    expect(result).toEqual(results);
  });

  it('returns an empty array when results key is missing', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await fetchNearby(59.33, 18.07, 50, TEST_OPTS);
    expect(result).toEqual([]);
  });

  it('throws on HTTP error', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(fetchNearby(59.33, 18.07, 50, TEST_OPTS)).rejects.toThrow(
      'GeoNames-data returnerade ett fel (HTTP 500).'
    );
  });

  it('builds the correct query URL with coordinates and radius', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    await fetchNearby(59.33, 18.07, 50, TEST_OPTS);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain(TEST_DATASET_URL);
    expect(url).toContain(encodeURIComponent("geom'POINT(18.07 59.33)'"));
    expect(url).toContain('50km');
    expect(options.headers['User-Agent']).toBe('HittaStaden/1.0');
  });

  it('requests population and coordinate fields', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    await fetchNearby(59.33, 18.07, 50, TEST_OPTS);

    const [url] = fetch.mock.calls[0];
    expect(url).toContain('population');
    expect(url).toContain('coordinates');
  });
});

// ---------------------------------------------------------------------------
// processPlaces
// ---------------------------------------------------------------------------
describe('processPlaces', () => {
  // Origin: Stockholm
  const originLat = 59.33;
  const originLon = 18.07;

  const makeRecord = (overrides) => ({
    name: 'Testort',
    coordinates: { lat: 59.5, lon: 18.1 },
    population: 15000,
    ...overrides,
  });

  it('filters out records that have no name', () => {
    const places = [
      makeRecord({ name: null, population: 5000 }),
      makeRecord({ name: 'Namngiven', population: 20000 }),
    ];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Namngiven');
  });

  it('filters out records whose name is blank/whitespace', () => {
    const places = [
      makeRecord({ name: '   ', population: 5000 }),
      makeRecord({ name: 'OK', population: 10000 }),
    ];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result).toHaveLength(1);
  });

  it('filters out the origin city by name', () => {
    const places = [
      makeRecord({ name: 'Stockholm', population: 1500000 }),
      makeRecord({ name: 'Sollentuna', population: 70000 }),
    ];
    const result = processPlaces(places, originLat, originLon, 'Stockholm');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Sollentuna');
  });

  it('does not filter any record when originName is null', () => {
    const places = [
      makeRecord({ name: 'A', population: 50000 }),
      makeRecord({ name: 'B', population: 20000 }),
    ];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result).toHaveLength(2);
  });

  it('reads lat/lon from the coordinates object', () => {
    const places = [makeRecord({ name: 'Nod', coordinates: { lat: 60.0, lon: 18.0 } })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].lat).toBe(60.0);
    expect(result[0].lon).toBe(18.0);
  });

  it('filters out records with no coordinates', () => {
    const noCoords = { name: 'Ingen position', population: 5000, coordinates: null };
    const result = processPlaces([noCoords], originLat, originLon, null);
    expect(result).toHaveLength(0);
  });

  it('assigns type "city" for population >= 50000', () => {
    const places = [makeRecord({ name: 'Storstad', population: 100000 })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].type).toBe('city');
    expect(result[0].category).toBe('place');
  });

  it('assigns type "town" for population 10000–49999', () => {
    const places = [makeRecord({ name: 'Mellanstor', population: 25000 })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].type).toBe('town');
  });

  it('assigns type "village" for population < 10000', () => {
    const places = [makeRecord({ name: 'Liten', population: 5000 })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].type).toBe('village');
  });

  it('sorts results by distance ascending', () => {
    const farPlace = makeRecord({ name: 'Långt bort', coordinates: { lat: originLat + 5, lon: originLon } });
    const nearPlace = makeRecord({ name: 'Nära', coordinates: { lat: originLat + 0.5, lon: originLon } });
    const result = processPlaces([farPlace, nearPlace], originLat, originLon, null);
    expect(result[0].name).toBe('Nära');
    expect(result[1].name).toBe('Långt bort');
  });

  it('calculates a realistic distance via haversine', () => {
    const place = makeRecord({ name: 'Uppland', coordinates: { lat: 59.83, lon: 18.07 } });
    const result = processPlaces([place], originLat, originLon, null);
    expect(result[0].dist).toBeGreaterThan(50);
    expect(result[0].dist).toBeLessThan(60);
  });

  it('includes population in the output', () => {
    const places = [makeRecord({ name: 'Stad', population: 80000 })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].population).toBe(80000);
  });

  it('returns at most 10 results', () => {
    const places = Array.from({ length: 15 }, (_, i) =>
      makeRecord({ name: `Ort${i}`, coordinates: { lat: originLat + (i + 1) * 0.1, lon: originLon } })
    );
    const result = processPlaces(places, originLat, originLon, null);
    expect(result).toHaveLength(10);
    // Should keep the 10 closest
    expect(result[0].name).toBe('Ort0');
    expect(result[9].name).toBe('Ort9');
  });
});

// ---------------------------------------------------------------------------
// Integration: search Borensberg → find nearby cities (real API calls, no mocks)
// These tests call the real Photon and GeoNames dataset APIs.
// A single beforeAll fetches the data so we don't hit rate limits.
// Skipped in CI because external APIs are unreliable in hosted runners.
// ---------------------------------------------------------------------------
describe.skipIf(process.env.CI)('integration: search for Borensberg and find nearby cities', () => {
  const TIMEOUT = 30_000;

  let origin;
  let records;
  let places;

  beforeAll(async () => {
    origin = await geocode('Borensberg');
    const originLat = parseFloat(origin.lat);
    const originLon = parseFloat(origin.lon);
    records = await fetchNearby(originLat, originLon, 50);
    const originDisplayName = origin.display_name.split(',')[0];
    places = processPlaces(records, originLat, originLon, originDisplayName);
  }, TIMEOUT);

  it('geocode returns coordinates for Borensberg', () => {
    expect(origin).toBeDefined();
    expect(origin.display_name).toBeDefined();
    const lat = parseFloat(origin.lat);
    const lon = parseFloat(origin.lon);
    expect(lat).toBeGreaterThan(58);
    expect(lat).toBeLessThan(59);
    expect(lon).toBeGreaterThan(15);
    expect(lon).toBeLessThan(16);
  });

  it('fetchNearby returns cities around Borensberg', () => {
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
  });

  it('Linköping is in the results', () => {
    const linkoping = places.find(p => p.name === 'Linköping');
    expect(linkoping).toBeDefined();
    expect(linkoping.type).toBe('city');
    expect(linkoping.category).toBe('place');
    expect(linkoping.dist).toBeGreaterThan(15);
    expect(linkoping.dist).toBeLessThan(40);
  });

  it('results are sorted by distance', () => {
    for (let i = 1; i < places.length; i++) {
      expect(places[i].dist).toBeGreaterThanOrEqual(places[i - 1].dist);
    }
  });

  it('every result has valid data', () => {
    for (const place of places) {
      expect(place.name).toBeTruthy();
      expect(typeof place.lat).toBe('number');
      expect(typeof place.lon).toBe('number');
      expect(place.dist).toBeGreaterThan(0);
    }
  });

  it('Borensberg itself is excluded from results', () => {
    const self = places.find(p => p.name === 'Borensberg');
    expect(self).toBeUndefined();
  });
});
