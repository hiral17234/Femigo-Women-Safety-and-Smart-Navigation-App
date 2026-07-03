'use server';
import { z } from 'zod';

const ORS_API_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY;

const PointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});
const SnapToRoadInputSchema = z.array(PointSchema);
type Point = z.infer<typeof PointSchema>;

// Uses OpenRouteService's free Snapping API to snap a path of coordinates to the nearest roads.
export async function snapToRoad(path: Point[]): Promise<Point[]> {
  if (!ORS_API_KEY) {
    console.error("OpenRouteService API Key is not configured.");
    return path;
  }

  if (path.length === 0) {
    return [];
  }

  // ORS snapping works on individual locations (not a full polyline like Google's Roads API),
  // so we snap each point independently against the road network.
  const validatedPath = SnapToRoadInputSchema.safeParse(path);
  if (!validatedPath.success) {
    console.error("Invalid path format for snapToRoad:", validatedPath.error);
    return path;
  }

  const locations = validatedPath.data.map(p => [p.lng, p.lat]);

  try {
    const response = await fetch('https://api.openrouteservice.org/v2/snap/driving-car', {
      method: 'POST',
      headers: {
        Authorization: ORS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locations,
        radius: 350, // search radius in meters to find a nearby road
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenRouteService Snapping API Error:', response.status, errorData);
      return path; // Return original points on API error, so tracking still works
    }

    const data = await response.json();

    if (data.locations) {
      return data.locations.map((loc: any, i: number) => {
        // ORS returns null for a location it couldn't snap (e.g. no road within radius) — fall back to the original point
        if (!loc || !loc.location) return path[i];
        return {
          lat: loc.location[1],
          lng: loc.location[0],
        };
      });
    }

    return path;
  } catch (error) {
    console.error('Failed to fetch from OpenRouteService Snapping API:', error);
    return path; // Return original path on network error
  }
}
