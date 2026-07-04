// Client-side helpers for Geoapify (geocoding) and OpenRouteService (routing)

export type LatLng = { lat: number; lng: number };

const GEOAPIFY_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
const ORS_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY;

// ---- Geocoding (address -> lat/lng) ----
export async function geocodeAddress(query: string): Promise<{ address: string; location: LatLng } | null> {
  if (!GEOAPIFY_KEY || !query.trim()) return null;
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&limit=1&apiKey=${GEOAPIFY_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.geometry.coordinates;
  return { address: feature.properties.formatted, location: { lat, lng } };
}

// ---- Reverse geocoding (lat/lng -> address) ----
export async function reverseGeocode(point: LatLng): Promise<string> {
  if (!GEOAPIFY_KEY) return "Your Location";
  const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${point.lat}&lon=${point.lng}&apiKey=${GEOAPIFY_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return "Your Location";
    const data = await res.json();
    const props = data.features?.[0]?.properties;
    if (!props) return "Your Location";
    // Prefer street-level detail over a landmark/POI name, which Geoapify sometimes
    // substitutes when you're near a well-known building.
    if (props.street) {
      return [props.housenumber, props.street, props.city].filter(Boolean).join(', ');
    }
    return props.formatted || "Your Location";
  } catch {
    return "Your Location";
  }
}
// ---- Autocomplete suggestions ----
export type AutocompleteSuggestion = { address: string; location: LatLng };

export async function autocompleteAddress(query: string): Promise<AutocompleteSuggestion[]> {
  if (!GEOAPIFY_KEY || query.trim().length < 3) return [];
  const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}&limit=5&apiKey=${GEOAPIFY_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map((f: any) => ({
      address: f.properties.formatted,
      location: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] },
    }));
  } catch {
    return [];
  }
}

// ---- Routing ----
export type TravelMode = 'DRIVING' | 'BICYCLING' | 'TRANSIT' | 'WALKING';

const modeToProfile: Record<TravelMode, string> = {
  DRIVING: 'driving-car',
  BICYCLING: 'cycling-regular',
  WALKING: 'foot-walking',
  TRANSIT: 'foot-walking', // no free transit routing available; approximated below
};

export type RouteResult = {
  path: LatLng[];        // decoded route geometry, for drawing on the map
  distanceMeters: number;
  durationSeconds: number;
  summary: string;
  isApproximate?: boolean;
};

export async function getRoutes(mode: TravelMode, start: LatLng, end: LatLng): Promise<RouteResult[]> {
  if (!ORS_KEY) return [];
  const profile = modeToProfile[mode];

  const body: any = {
    coordinates: [
      [start.lng, start.lat],
      [end.lng, end.lat],
    ],
  };

  // Alternative routes aren't supported on every ORS profile; request them and fall back gracefully.
  if (mode !== 'TRANSIT') {
    body.alternative_routes = { target_count: 3, weight_factor: 1.6, share_factor: 0.6 };
  }

  const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: 'POST',
    headers: {
      Authorization: ORS_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error('ORS routing failed', await res.text());
    return [];
  }

  const data = await res.json();

  const routes: RouteResult[] = (data.features || []).map((feature: any, idx: number) => {
    const coords = feature.geometry.coordinates as [number, number][];
    const path = coords.map(([lng, lat]) => ({ lat, lng }));
    const summary = feature.properties.summary;
    return {
      path,
      distanceMeters: summary.distance,
      durationSeconds: mode === 'TRANSIT' ? summary.duration * 1.3 : summary.duration, // rough transit padding
      summary: idx === 0 ? 'Recommended Route' : `Alternate Route ${idx}`,
      isApproximate: mode === 'TRANSIT',
    };
  });

  return routes;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} mins`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}
