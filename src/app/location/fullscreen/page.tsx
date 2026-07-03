'use client';
export const dynamic = 'force-dynamic';

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import nextDynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMap } from 'react-leaflet';
import { ArrowLeft, LocateFixed, Search, Siren, Hospital, Trash2, Loader2, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { snapToRoad } from '@/app/actions/snap-to-road';
import { findNearbyPlaces } from '@/app/actions/find-nearby-places';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { geocodeAddress } from '@/app/actions/geocode-address';

// Leaflet needs `window`, so map pieces are loaded client-side only.
const MapContainer = nextDynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false });
const TileLayer = nextDynamic(() => import('react-leaflet').then(m => m.TileLayer), { ssr: false });
const Marker = nextDynamic(() => import('react-leaflet').then(m => m.Marker), { ssr: false });
const Polyline = nextDynamic(() => import('react-leaflet').then(m => m.Polyline), { ssr: false });

type Point = { lat: number; lng: number };
type Place = { name: string; vicinity?: string; location: Point; place_id: string };

// Helper function to parse DMS coordinates
function parseDMSToLatLng(dmsStr: string): Point | null {
  const regex = /(\d{1,3}(?:\.\d+)?)°\s*(\d{1,2}(?:\.\d+)?)'\s*([\d.]+)"\s*([NS])[\s,]+(\d{1,3}(?:\.\d+)?)°\s*(\d{1,2}(?:\.\d+)?)'\s*([\d.]+)"\s*([EW])/i;
  const match = dmsStr.match(regex);

  if (!match) return null;

  try {
    const latDegrees = parseFloat(match[1]);
    const latMinutes = parseFloat(match[2]);
    const latSeconds = parseFloat(match[3]);
    const latDirection = match[4].toUpperCase();

    const lonDegrees = parseFloat(match[5]);
    const lonMinutes = parseFloat(match[6]);
    const lonSeconds = parseFloat(match[7]);
    const lonDirection = match[8].toUpperCase();

    if (latDegrees > 90 || lonDegrees > 180 || latMinutes >= 60 || lonMinutes >= 60 || latSeconds >= 60 || lonSeconds >= 60) return null;

    let lat = latDegrees + (latMinutes / 60) + (latSeconds / 3600);
    if (latDirection === 'S') lat = -lat;

    let lng = lonDegrees + (lonMinutes / 60) + (lonSeconds / 3600);
    if (lonDirection === 'W') lng = -lng;

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}

// Divicon-based markers (Leaflet's default marker images don't bundle well with Next.js)
function useDivIcon(html: string, size: [number, number] = [32, 32]) {
  const [icon, setIcon] = useState<any>(null);
  useEffect(() => {
    import('leaflet').then((L) => {
      setIcon(
        L.divIcon({
          html,
          className: 'bg-transparent border-0',
          iconSize: size,
          iconAnchor: [size[0] / 2, size[1] / 2],
        })
      );
    });
  }, [html]);
  return icon;
}

function useNearbyPlaceIcon(place: Place, type: 'police' | 'hospital' | null) {
  const emoji = type === 'police' ? '🚓' : '🏥';
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px);">
      <div style="background:white;border-radius:9999px;padding:6px;box-shadow:0 2px 6px rgba(0,0,0,0.4);border:2px solid hsl(var(--primary));font-size:18px;line-height:1;">${emoji}</div>
      <div style="background:white;color:#111;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.4);margin-top:2px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;">${place.name}</div>
    </div>
  `;
  return useDivIcon(html, [40, 54]);
}

// Imperatively pans/zooms the Leaflet map instance from outside <MapContainer>
function MapController({ flyTo }: { flyTo: { center: Point; zoom: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (flyTo) {
      map.setView([flyTo.center.lat, flyTo.center.lng], flyTo.zoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo]);
  return null;
}

function NearbyPlaceMarker({ place, type }: { place: Place; type: 'police' | 'hospital' | null }) {
  const icon = useNearbyPlaceIcon(place, type);
  if (!icon) return null;
  return <Marker position={[place.location.lat, place.location.lng] as any} icon={icon} />;
}

function FullscreenMap() {
  const { toast } = useToast();
  const [userLocation, setUserLocation] = useState<Point | null>(null);
  const rawPathRef = useRef<Point[]>([]);
  const [snappedPath, setSnappedPath] = useState<Point[]>([]);
  const [mapCenter] = useState<Point>({ lat: 20.5937, lng: 78.9629 });
  const [mapZoom] = useState(4);
  const [flyTo, setFlyTo] = useState<{ center: Point; zoom: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLocationSet, setInitialLocationSet] = useState(false);
  const isProcessingRef = useRef(false);

  const [nearbyPlaces, setNearbyPlaces] = useState<Place[]>([]);
  const [placeType, setPlaceType] = useState<'police' | 'hospital' | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchedLocation, setSearchedLocation] = useState<Point | null>(null);

  const searchParams = useSearchParams();

  const userIcon = useDivIcon(
    `<div style="position:relative;width:20px;height:20px;"><div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.7);animation:pulse 1.5s infinite;"></div><div style="position:absolute;inset:5px;border-radius:50%;background:#3b82f6;border:2px solid white;"></div></div>`,
    [20, 20]
  );
  const searchedIcon = useDivIcon(
    `<svg width="32" height="32" viewBox="0 0 24 24" fill="#ef4444" stroke="white" stroke-width="1.5"><path d="M12 21s-8-7.5-8-13a8 8 0 1 1 16 0c0 5.5-8 13-8 13z"/><circle cx="12" cy="8" r="3" fill="white"/></svg>`
  );

  const processPath = useCallback(async () => {
    if (isProcessingRef.current || rawPathRef.current.length === 0) return;
    isProcessingRef.current = true;

    const path_to_snap = [...(snappedPath.slice(-1)), ...rawPathRef.current];
    const currentRawPoints = [...rawPathRef.current];
    rawPathRef.current = [];

    try {
      const newSnappedPoints = await snapToRoad(path_to_snap);
      if (newSnappedPoints && newSnappedPoints.length > 0) {
        setSnappedPath(prev => {
          const prevPath = prev.length > 0 ? prev.slice(0, -1) : [];
          return [...prevPath, ...newSnappedPoints];
        });
      } else {
        rawPathRef.current = [...currentRawPoints, ...rawPathRef.current];
      }
    } catch (e) {
      console.error("Failed to snap to road:", e);
      rawPathRef.current = [...currentRawPoints, ...rawPathRef.current];
    } finally {
      isProcessingRef.current = false;
    }
  }, [snappedPath]);

  const handleFindNearby = useCallback(async (type: 'police' | 'hospital') => {
    if (!userLocation) {
      toast({ variant: 'destructive', title: 'Your location is not available yet.' });
      return;
    }
    setPlaceType(type);
    toast({ title: `Searching for nearby ${type}...` });
    const places = await findNearbyPlaces({ location: userLocation, placeType: type });
    setNearbyPlaces(places);
    if (places.length === 0) {
      toast({ variant: 'destructive', title: 'No places found nearby.' });
    }
  }, [userLocation, toast]);

  // Auto-search effect based on URL param
  useEffect(() => {
    const findType = searchParams.get('find');
    if (userLocation && (findType === 'police' || findType === 'hospital')) {
      handleFindNearby(findType);
    }
  }, [searchParams, userLocation, handleFindNearby]);

  useEffect(() => {
    let watchId: number;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const newLocation: Point = { lat: latitude, lng: longitude };

          setUserLocation(newLocation);
          rawPathRef.current.push(newLocation);

          if (!initialLocationSet) {
            setFlyTo({ center: newLocation, zoom: 15 });
            setSnappedPath([newLocation]);
            setInitialLocationSet(true);
          }
          setError(null);
        },
        (err) => {
          console.error("Error getting geolocation:", err);
          setError("Could not get your location. Please enable location services in your browser settings.");
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      setError("Geolocation is not supported by this browser.");
    }
  }, [initialLocationSet]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (rawPathRef.current.length > 0) {
        processPath();
      }
    }, 5000);
    return () => clearInterval(intervalId);
  }, [processPath]);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchedLocation(null);
    }
  }, [searchQuery]);

  const handleRecenter = () => {
    if (userLocation) {
      setFlyTo({ center: userLocation, zoom: 15 });
    }
  };

  const handleClearPlaces = () => {
    setNearbyPlaces([]);
    setPlaceType(null);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;

    setIsSearching(true);
    toast({ title: 'Searching...', description: `Finding "${searchQuery}"` });
    setSearchedLocation(null);

    const dmsCoords = parseDMSToLatLng(searchQuery);
    if (dmsCoords) {
      setFlyTo({ center: dmsCoords, zoom: 15 });
      setSearchedLocation(dmsCoords);
      toast({ title: 'Location Found', description: 'Displaying coordinates on map.' });
      setIsSearching(false);
      return;
    }

    try {
      const location = await geocodeAddress(searchQuery);
      if (location) {
        setFlyTo({ center: location, zoom: 15 });
        setSearchedLocation(location);
      } else {
        toast({
          variant: 'destructive',
          title: 'Location not found',
          description: `Could not find a location for "${searchQuery}".`
        });
      }
    } catch (error) {
      console.error("Geocoding API call failed", error);
      toast({
        variant: 'destructive',
        title: 'Search Error',
        description: 'An error occurred during the search. Please try again.'
      });
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <main className="h-screen w-screen flex flex-col bg-[#06010F] relative">
      <div className="absolute top-0 left-0 z-[401] p-4 flex items-start gap-4 w-full">
        <Link href="/location">
          <Button variant="outline" size="icon" className="bg-background/80 hover:bg-background text-foreground backdrop-blur-sm rounded-full shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <form onSubmit={handleSearch} className="w-full max-w-sm flex gap-2">
          <Input
            placeholder="Search for a location or coordinates..."
            className="bg-background/80 border-gray-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={isSearching}
          />
          <Button type="submit" variant="outline" size="icon" className="bg-background/80 hover:bg-background text-foreground backdrop-blur-sm rounded-full shrink-0" disabled={isSearching}>
            {isSearching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          </Button>
        </form>
      </div>

      <MapContainer center={[mapCenter.lat, mapCenter.lng] as any} zoom={mapZoom} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController flyTo={flyTo} />

        {userLocation && userIcon && <Marker position={[userLocation.lat, userLocation.lng] as any} icon={userIcon} />}
        {searchedLocation && searchedIcon && <Marker position={[searchedLocation.lat, searchedLocation.lng] as any} icon={searchedIcon} />}

        {snappedPath.length > 1 && (
          <Polyline
            positions={snappedPath.map(p => [p.lat, p.lng]) as any}
            pathOptions={{ color: '#ec4899', weight: 6, opacity: 0.9 }}
          />
        )}

        {nearbyPlaces.map((place) => (
          <NearbyPlaceMarker key={place.place_id} place={place} type={placeType} />
        ))}
      </MapContainer>

      <div className="absolute bottom-16 sm:bottom-4 left-4 z-[401] flex flex-col gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={() => handleFindNearby('police')} className="bg-background/80 hover:bg-background text-foreground backdrop-blur-sm rounded-full">
                <Siren className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Find Police</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={() => handleFindNearby('hospital')} className="bg-background/80 hover:bg-background text-foreground backdrop-blur-sm rounded-full">
                <Hospital className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Find Hospital</p></TooltipContent>
          </Tooltip>
          {nearbyPlaces.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="destructive" size="icon" onClick={handleClearPlaces} className="backdrop-blur-sm rounded-full">
                  <Trash2 className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right"><p>Clear Places</p></TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      </div>

      <div className="absolute bottom-16 sm:bottom-4 right-4 z-[401]">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRecenter}
                disabled={!userLocation}
                className="bg-background/80 hover:bg-background text-foreground backdrop-blur-sm rounded-full"
              >
                <LocateFixed className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Re-center on me</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {error && (
        <div className="absolute top-20 left-1/2 z-[401] w-full max-w-md -translate-x-1/2 p-4">
          <Alert variant="destructive">
            <AlertTitle>Location Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
      {!userLocation && !error && (
        <div className="absolute inset-0 z-[402] flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <div className="text-center space-y-4 text-foreground">
            <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
              <div className="absolute h-full w-full animate-ping rounded-full bg-primary/50" />
              <Skeleton className="h-full w-full rounded-full" />
            </div>
            <h2 className="text-2xl font-bold">Finding your location...</h2>
            <p className="text-muted-foreground">Please allow location access if prompted.</p>
          </div>
        </div>
      )}
    </main>
  );
}

export default function FullscreenMapPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-background flex items-center justify-center"><Loader2 className="h-10 w-10 animate-spin" /></div>}>
      <FullscreenMap />
    </Suspense>
  );
}
