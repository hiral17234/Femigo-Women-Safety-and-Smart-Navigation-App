import { db, auth } from "@/lib/firebase";
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";
import type { LatLng } from "@/lib/mapping";

export type TripStatus = "active" | "completed";

export type Trip = {
  id: string;
  startAddress: string;
  destinationAddress: string;
  travelMode: string;
  status: TripStatus;
  startedAt: string; // ISO string
  endedAt: string | null;
  path: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
};

// Firestore documents have a 1MB limit and we don't need every single GPS tick —
// downsample long paths before saving so a long trip never blows past reasonable size.
function simplifyPath(path: LatLng[], maxPoints = 300): LatLng[] {
  if (path.length <= maxPoints) return path;
  const step = path.length / maxPoints;
  const result: LatLng[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(path[Math.floor(i * step)]);
  }
  result.push(path[path.length - 1]);
  return result;
}

function tripsCollection(uid: string) {
  return collection(db, "users", uid, "trips");
}

export async function startTrip(trip: {
  id: string;
  startAddress: string;
  destinationAddress: string;
  travelMode: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const tripDoc: Trip = {
    id: trip.id,
    startAddress: trip.startAddress,
    destinationAddress: trip.destinationAddress,
    travelMode: trip.travelMode,
    status: "active",
    startedAt: new Date().toISOString(),
    endedAt: null,
    path: [],
    distanceMeters: 0,
    durationSeconds: 0,
  };

  await setDoc(doc(tripsCollection(uid), trip.id), tripDoc);
}

export async function updateTripProgress(
  tripId: string,
  path: LatLng[],
  distanceMeters: number
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  try {
    await updateDoc(doc(tripsCollection(uid), tripId), {
      path: simplifyPath(path),
      distanceMeters,
      lastUpdatedAt: serverTimestamp(),
    });
  } catch (e) {
    // Non-fatal — periodic saves are a safety net, not critical-path.
    console.warn("Failed to save trip progress:", e);
  }
}

export async function endTrip(
  tripId: string,
  path: LatLng[],
  distanceMeters: number,
  durationSeconds: number
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  await updateDoc(doc(tripsCollection(uid), tripId), {
    status: "completed",
    endedAt: new Date().toISOString(),
    path: simplifyPath(path),
    distanceMeters,
    durationSeconds,
  });
}

export async function getTripHistory(): Promise<Trip[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];

  const q = query(tripsCollection(uid), orderBy("startedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Trip);
}

// ---- Local persistence for the ACTIVE trip only, so a page reload can restore it ----
// This is separate from Firestore history — it's just a short-lived cache of "what was I doing right now".
const ACTIVE_TRIP_KEY = "femigo-active-trip";

export type ActiveTripCache = {
  tripId: string;
  startAddress: string;
  startLocation: LatLng;
  destinationAddress: string;
  destinationLocation: LatLng;
  travelMode: string;
  path: LatLng[];
  startedAt: string;
};

export function saveActiveTripLocally(data: ActiveTripCache): void {
  try {
    localStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to cache active trip:", e);
  }
}

export function loadActiveTripLocally(): ActiveTripCache | null {
  try {
    const raw = localStorage.getItem(ACTIVE_TRIP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearActiveTripLocally(): void {
  localStorage.removeItem(ACTIVE_TRIP_KEY);
}
