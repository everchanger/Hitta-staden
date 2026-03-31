import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  haversine,
  formatDistance,
  escapeHtml,
  PLACE_TYPE_LABELS,
  OVERPASS_ENDPOINTS,
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
    const expectedKeys = [
      'city', 'town', 'village', 'hamlet',
      'attraction', 'monument', 'castle', 'ruins',
      'archaeological_site', 'memorial', 'museum', 'church',
      'palace', 'fort', 'city_gate', 'manor', 'historic',
    ];
    for (const key of expectedKeys) {
      expect(PLACE_TYPE_LABELS).toHaveProperty(key);
    }
  });

  it('has Swedish labels for common types', () => {
    expect(PLACE_TYPE_LABELS.city).toBe('Stad');
    expect(PLACE_TYPE_LABELS.town).toBe('Tätort');
    expect(PLACE_TYPE_LABELS.castle).toBe('Slott/Borg');
    expect(PLACE_TYPE_LABELS.church).toBe('Kyrka');
  });
});

// ---------------------------------------------------------------------------
// OVERPASS_ENDPOINTS
// ---------------------------------------------------------------------------
describe('OVERPASS_ENDPOINTS', () => {
  it('contains exactly 4 endpoints', () => {
    expect(OVERPASS_ENDPOINTS).toHaveLength(4);
  });

  it('contains all expected Overpass mirror URLs', () => {
    expect(OVERPASS_ENDPOINTS).toContain('https://overpass-api.de/api/interpreter');
    expect(OVERPASS_ENDPOINTS).toContain('https://overpass.kumi.systems/api/interpreter');
    expect(OVERPASS_ENDPOINTS).toContain('https://overpass.private.coffee/api/interpreter');
    expect(OVERPASS_ENDPOINTS).toContain('https://overpass.openstreetmap.fr/api/interpreter');
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

  it('returns the first result from Nominatim on success', async () => {
    const mockResult = {
      display_name: 'Stockholm, Sweden',
      lat: '59.3293',
      lon: '18.0686',
      osm_id: 12345,
    };
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [mockResult],
    });

    const result = await geocode('Stockholm');
    expect(result).toEqual(mockResult);
    expect(fetch).toHaveBeenCalledOnce();
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('Stockholm');
    expect(url).toContain('nominatim.openstreetmap.org');
  });

  it('throws a descriptive error when city is not found', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await expect(geocode('XYZBogusCity')).rejects.toThrow(
      'Kunde inte hitta "XYZBogusCity". Försök med ett annat namn.'
    );
  });

  it('throws on HTTP error from Nominatim', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(geocode('Stockholm')).rejects.toThrow(
      'Nominatim returnerade ett fel (HTTP 500).'
    );
  });

  it('sends the Accept-Language header', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ display_name: 'Göteborg, Sweden', lat: '57.71', lon: '11.97' }],
    });

    await geocode('Göteborg');
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Accept-Language']).toBe('sv,en');
    expect(options.headers['User-Agent']).toBe('HittaStaden/1.0');
  });
});

// ---------------------------------------------------------------------------
// fetchNearby  (uses mocked fetch)
// ---------------------------------------------------------------------------
describe('fetchNearby', () => {
  const TEST_ENDPOINTS = ['https://endpoint-a.test', 'https://endpoint-b.test'];
  const TEST_OPTS = {
    endpoints: TEST_ENDPOINTS,
    serverTimeoutS: 5,
    clientTimeoutMs: 60000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns elements from the first responding endpoint', async () => {
    const elements = [{ id: 1, tags: { name: 'Plats A' } }];
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ elements }),
    });

    const result = await fetchNearby(59.33, 18.07, 50, TEST_OPTS);
    expect(result).toEqual(elements);
  });

  it('returns an empty array when elements key is missing', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const result = await fetchNearby(59.33, 18.07, 50, TEST_OPTS);
    expect(result).toEqual([]);
  });

  it('falls back to the second endpoint if the first throws', async () => {
    const elements = [{ id: 2, tags: { name: 'Plats B' } }];
    fetch
      .mockRejectedValueOnce(new Error('endpoint-a down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ elements }),
      });

    const result = await fetchNearby(59.33, 18.07, 50, TEST_OPTS);
    expect(result).toEqual(elements);
  });

  it('throws after all retries are exhausted when every endpoint fails', async () => {
    fetch.mockRejectedValue(new Error('all down'));

    // Assert rejection and advance fake timers concurrently so the promise
    // is always observed before it can become an unhandled rejection.
    await Promise.all([
      expect(fetchNearby(59.33, 18.07, 50, {
        ...TEST_OPTS,
        clientTimeoutMs: 60000,
      })).rejects.toThrow('Overpass API är inte tillgänglig. Försök igen senare.'),
      vi.advanceTimersByTimeAsync(2100),
    ]);
  });

  it('throws on HTTP error from an endpoint', async () => {
    fetch.mockResolvedValue({ ok: false, status: 429 });

    await Promise.all([
      expect(fetchNearby(59.33, 18.07, 50, TEST_OPTS)).rejects.toThrow(
        'Overpass API är inte tillgänglig. Försök igen senare.'
      ),
      vi.advanceTimersByTimeAsync(2100),
    ]);
  });

  it('uses POST with url-encoded body', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    });

    await fetchNearby(59.33, 18.07, 50, TEST_OPTS);

    const [url, options] = fetch.mock.calls[0];
    expect(TEST_ENDPOINTS).toContain(url);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(options.headers['User-Agent']).toBe('HittaStaden/1.0');
    expect(options.body).toMatch(/^data=/);
  });
});

// ---------------------------------------------------------------------------
// processPlaces
// ---------------------------------------------------------------------------
describe('processPlaces', () => {
  // Origin: Stockholm
  const originLat = 59.33;
  const originLon = 18.07;

  const makeNode = (overrides) => ({
    id: 1,
    lat: 59.5,
    lon: 18.1,
    tags: { name: 'Testort', place: 'town' },
    ...overrides,
  });

  it('filters out elements that have no name tag', () => {
    const places = [
      makeNode({ id: 1, tags: { place: 'town' } }),          // no name → filtered
      makeNode({ id: 2, tags: { name: 'Namngiven', place: 'city' } }),
    ];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Namngiven');
  });

  it('filters out elements whose name is blank/whitespace', () => {
    const places = [
      makeNode({ id: 1, tags: { name: '   ', place: 'town' } }),
      makeNode({ id: 2, tags: { name: 'OK', place: 'town' } }),
    ];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result).toHaveLength(1);
  });

  it('filters out the origin element by osm_id', () => {
    const places = [
      makeNode({ id: 42, tags: { name: 'Origin City', place: 'city' } }),
      makeNode({ id: 99, tags: { name: 'Nearby', place: 'town' } }),
    ];
    const result = processPlaces(places, originLat, originLon, '42');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Nearby');
  });

  it('does not filter any element when originOsmId is null', () => {
    const places = [
      makeNode({ id: 42, tags: { name: 'A', place: 'city' } }),
      makeNode({ id: 99, tags: { name: 'B', place: 'town' } }),
    ];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result).toHaveLength(2);
  });

  it('reads lat/lon directly from a node', () => {
    const places = [makeNode({ id: 1, lat: 60.0, lon: 18.0, tags: { name: 'Nod', place: 'town' } })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].lat).toBe(60.0);
    expect(result[0].lon).toBe(18.0);
  });

  it('reads lat/lon from the center property of a way', () => {
    const way = {
      id: 10,
      center: { lat: 60.1, lon: 18.2 },
      tags: { name: 'Väg', place: 'village' },
    };
    const result = processPlaces([way], originLat, originLon, null);
    expect(result[0].lat).toBe(60.1);
    expect(result[0].lon).toBe(18.2);
  });

  it('filters out elements with no resolvable coordinates', () => {
    const noCoords = { id: 5, tags: { name: 'Ingen position', place: 'town' } };
    const result = processPlaces([noCoords], originLat, originLon, null);
    expect(result).toHaveLength(0);
  });

  it('assigns category "place" and correct type for place nodes', () => {
    const places = [makeNode({ tags: { name: 'Stad', place: 'city' } })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].category).toBe('place');
    expect(result[0].type).toBe('city');
  });

  it('assigns category "landmark" and correct type for tourism nodes', () => {
    const places = [makeNode({ tags: { name: 'Sevärdhet', tourism: 'attraction' } })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].category).toBe('landmark');
    expect(result[0].type).toBe('attraction');
  });

  it('assigns category "landmark" and correct type for historic nodes', () => {
    const places = [makeNode({ tags: { name: 'Slott', historic: 'castle' } })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].category).toBe('landmark');
    expect(result[0].type).toBe('castle');
  });

  it('falls back to "historic" type when historic tag value is missing', () => {
    const places = [makeNode({ tags: { name: 'Okänd historik' } })];
    const result = processPlaces(places, originLat, originLon, null);
    expect(result[0].type).toBe('historic');
    expect(result[0].category).toBe('landmark');
  });

  it('sorts results by distance ascending', () => {
    // Place A is much further (latitude +5) than place B (latitude +0.5)
    const farPlace = makeNode({ id: 1, lat: originLat + 5, lon: originLon, tags: { name: 'Långt bort', place: 'city' } });
    const nearPlace = makeNode({ id: 2, lat: originLat + 0.5, lon: originLon, tags: { name: 'Nära', place: 'town' } });
    const result = processPlaces([farPlace, nearPlace], originLat, originLon, null);
    expect(result[0].name).toBe('Nära');
    expect(result[1].name).toBe('Långt bort');
  });

  it('calculates a realistic distance via haversine', () => {
    // Roughly 55 km north of Stockholm
    const place = makeNode({ lat: 59.83, lon: 18.07, tags: { name: 'Uppland', place: 'town' } });
    const result = processPlaces([place], originLat, originLon, null);
    expect(result[0].dist).toBeGreaterThan(50);
    expect(result[0].dist).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------
// Integration: search Borensberg → find Linköping (real API calls, no mocks)
// These tests call the real Nominatim and Overpass APIs.
// A single beforeAll fetches the data so we don't hit API rate limits.
// ---------------------------------------------------------------------------
describe('integration: search for Borensberg and find nearby cities', () => {
  const TIMEOUT = 60_000;

  let origin;
  let elements;
  let places;

  beforeAll(async () => {
    origin = await geocode('Borensberg');
    const originLat = parseFloat(origin.lat);
    const originLon = parseFloat(origin.lon);
    elements = await fetchNearby(originLat, originLon, 50);
    const originOsmId = origin.osm_id ? String(origin.osm_id) : null;
    places = processPlaces(elements, originLat, originLon, originOsmId);
  }, TIMEOUT);

  it('geocode returns coordinates for Borensberg', () => {
    expect(origin).toBeDefined();
    expect(origin.display_name).toBeDefined();
    // Borensberg is in Östergötland – verify coordinates are reasonable
    const lat = parseFloat(origin.lat);
    const lon = parseFloat(origin.lon);
    expect(lat).toBeGreaterThan(58);
    expect(lat).toBeLessThan(59);
    expect(lon).toBeGreaterThan(15);
    expect(lon).toBeLessThan(16);
  });

  it('fetchNearby returns places around Borensberg', () => {
    expect(Array.isArray(elements)).toBe(true);
    expect(elements.length).toBeGreaterThan(0);
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
    const originOsmId = origin.osm_id ? String(origin.osm_id) : null;
    const self = places.find(p => String(p.id) === originOsmId);
    expect(self).toBeUndefined();
  });
});
