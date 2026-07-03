'use server';

import { z } from 'zod';

const PointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});
type Point = z.infer<typeof PointSchema>;

const FindNearbyPlacesInputSchema = z.object({
  location: PointSchema,
  placeType: z.enum(['police', 'hospital']),
  radius: z.number().min(1).max(50000).default(5000), // 5km radius
});
export type FindNearbyPlacesInput = z.infer<typeof FindNearbyPlacesInputSchema>;

const PlaceSchema = z.object({
  name: z.string(),
  vicinity: z.string().optional(),
  location: PointSchema,
  place_id: z.string(),
});
export type Place = z.infer<typeof PlaceSchema>;

// Overpass (OpenStreetMap) tag mapping for each supported place type.
// police -> amenity=police, hospital -> amenity=hospital
const OSM_AMENITY_TAG: Record<FindNearbyPlacesInput['placeType'], string> = {
  police: 'police',
  hospital: 'hospital',
};

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

// This function queries the Overpass API (OpenStreetMap) to find nearby
// places of a certain type. No API key is required, keeping this consistent
// with the rest of the app's OSM/Leaflet-based mapping stack.
export async function findNearbyPlaces(
  input: FindNearbyPlacesInput
): Promise<Place[]> {
  const validatedInput = FindNearbyPlacesInputSchema.safeParse(input);
  if (!validatedInput.success) {
    console.error('Invalid input for findNearbyPlaces:', validatedInput.error);
    return [];
  }

  const { location, placeType, radius } = validatedInput.data;
  const amenity = OSM_AMENITY_TAG[placeType];

  // Overpass QL: find nodes/ways/relations tagged amenity=<type> within
  // `radius` meters of the given point. `out center` gives us a lat/lon
  // even for way/relation results (e.g. a hospital mapped as a building outline).
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="${amenity}"](around:${radius},${location.lat},${location.lng});
      way["amenity"="${amenity}"](around:${radius},${location.lat},${location.lng});
      relation["amenity"="${amenity}"](around:${radius},${location.lat},${location.lng});
    );
    out center tags;
  `;

  try {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Overpass API HTTP Error:', response.status, errorText);
      throw new Error('Failed to fetch data from Overpass API.');
    }

    const data: OverpassResponse = await response.json();

    if (!data.elements || data.elements.length === 0) {
      return [];
    }

    const places = data.elements
      .map((el) => {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat === undefined || lng === undefined) return null;

        const tags = el.tags ?? {};
        const name = tags.name ?? `Unnamed ${placeType}`;
        const addressParts = [
          tags['addr:housenumber'],
          tags['addr:street'],
          tags['addr:suburb'],
          tags['addr:city'],
        ].filter(Boolean);

        return {
          name,
          vicinity: addressParts.length > 0 ? addressParts.join(', ') : undefined,
          location: { lat, lng },
          place_id: `${el.type}/${el.id}`,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // Validate shape before returning so malformed OSM data fails loudly
    // instead of silently propagating downstream.
    const parsedPlaces = z.array(PlaceSchema).safeParse(places);
    if (!parsedPlaces.success) {
      console.error('Malformed places data from Overpass API:', parsedPlaces.error);
      return [];
    }

    return parsedPlaces.data;
  } catch (error) {
    console.error('Failed to fetch from Overpass API:', error);
    throw new Error('An unexpected error occurred while finding nearby places.');
  }
}
