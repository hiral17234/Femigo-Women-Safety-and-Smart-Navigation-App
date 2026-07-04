'use client';
export const dynamic = 'force-dynamic';
import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import nextDynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Car, Bike, TramFront, Footprints, ArrowRightLeft, Share2, MapPin, Circle, Loader2, Maximize, Users, MessageSquare, Mail, Copy, LocateFixed, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { snapToRoad } from '@/app/actions/snap-to-road';
import { getRouteSafetyDetails } from '@/ai/flows/route-safety-flow';
import { recommendSafestRoute } from '@/ai/flows/recommend-safest-route-flow';
import { Badge } from '@/components/ui/badge';
import { type RouteSafetyOutput } from '@/ai/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AddressAutocomplete } from '@/components/location/address-autocomplete';
import { geocodeAddress, reverseGeocode, getRoutes, formatDistance, formatDuration, computePathDistance, type LatLng, type TravelMode, type RouteResult } from '@/lib/mapping';
import { startTrip, updateTripProgress, endTrip, saveActiveTripLocally, loadActiveTripLocally, clearActiveTripLocally, type ActiveTripCache } from '@/lib/trip-storage';

// Leaflet needs `window`, so map pieces are loaded client-side only.
const MapContainer = nextDynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false });
const TileLayer = nextDynamic(() => import('react-leaflet').then(m => m.TileLayer), { ssr: false });
const Marker = nextDynamic(() => import('react-leaflet').then(m => m.Marker), { ssr: false });
const Polyline = nextDynamic(() => import('react-leaflet').then(m => m.Polyline), { ssr: false });
const MapUpdater = nextDynamic(() => import('@/components/location/map-updater').then(m => m.MapUpdater), { ssr: false });

type Place = { address: string; location: LatLng | null };
type RouteDetail = RouteSafetyOutput & { isGenerated?: boolean };
type TrustedContact = { id: string; name: string; phone: string; };
type FullRoute = RouteResult & { details?: RouteDetail };

// Helper to parse DMS coordinates like `12°34'56.7"N 77°12'34.5"E`
function parseDMSToLatLng(dmsStr: string): LatLng | null {
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
          iconAnchor: [size[0] / 2, size[1]],
        })
      );
    });
  }, [html]);
  return icon;
}

function LocationPlanner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng>({ lat: 20.5937, lng: 78.9629 });
  const [mapZoom, setMapZoom] = useState(4);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [travelMode, setTravelMode] = useState<TravelMode>('WALKING');

  const [startInputText, setStartInputText] = useState('');
  const [destInputText, setDestInputText] = useState('');
  const [startPoint, setStartPoint] = useState<Place>({ address: "", location: null });
  const [destinationPoint, setDestinationPoint] = useState<Place>({ address: "", location: null });

  const [routes, setRoutes] = useState<FullRoute[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [recommendation, setRecommendation] = useState<{ index: number; reason: string } | null>(null);

  const [isTracking, setIsTracking] = useState(false);
  const [livePath, setLivePath] = useState<LatLng[]>([]);
  const rawPathRef = useRef<LatLng[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const isRecalculatingRef = useRef(false);
  const isRecalculatingRef = useRef(false);
  const tripIdRef = useRef<string | null>(null);
  const lastProgressSaveRef = useRef<number>(0);

  const [isShareOpen, setIsShareOpen] = useState(false);

  const userIcon = useDivIcon(
    `<div style="position:relative;width:20px;height:20px;"><div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.7);animation:pulse 1.5s infinite;"></div><div style="position:absolute;inset:5px;border-radius:50%;background:#3b82f6;border:2px solid white;"></div></div>`,
    [20, 20]
  );
  const startIcon = useDivIcon(
    `<svg width="32" height="32" viewBox="0 0 24 24" fill="#22c55e" stroke="white" stroke-width="1.5"><path d="M12 21s-8-7.5-8-13a8 8 0 1 1 16 0c0 5.5-8 13-8 13z"/><circle cx="12" cy="8" r="3" fill="white"/></svg>`
  );
  const destIcon = useDivIcon(
    `<svg width="32" height="32" viewBox="0 0 24 24" fill="#ef4444" stroke="white" stroke-width="1.5"><path d="M12 21s-8-7.5-8-13a8 8 0 1 1 16 0c0 5.5-8 13-8 13z"/><circle cx="12" cy="8" r="3" fill="white"/></svg>`
  );

  const handleSetCurrentLocation = useCallback(async (location: LatLng) => {
    setUserLocation(location);
    setIsFetchingLocation(true);
    try {
      const address = await reverseGeocode(location);
      setStartPoint({ address, location });
      setStartInputText(address);
    } catch {
      setStartPoint({ address: "Your Location", location });
      setStartInputText("Your Location");
    } finally {
      setIsFetchingLocation(false);
      setMapCenter(location);
      setMapZoom(15);
    }
  }, []);

  const fetchCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast({ variant: 'destructive', title: 'Geolocation is not supported.' });
      return;
    }
    setIsFetchingLocation(true);
    toast({ title: 'Fetching your location...' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        handleSetCurrentLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        toast.dismiss();
      },
      () => {
        toast({ variant: 'destructive', title: 'Could not get your location.', description: "Please enable location services and try again." });
        setIsFetchingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [handleSetCurrentLocation, toast]);

 useEffect(() => {
    // Restore an in-progress trip if one exists (e.g. after a page reload while tracking).
    const cached = loadActiveTripLocally();
    if (cached) {
      tripIdRef.current = cached.tripId;
      setStartPoint({ address: cached.startAddress, location: cached.startLocation });
      setStartInputText(cached.startAddress);
      setDestinationPoint({ address: cached.destinationAddress, location: cached.destinationLocation });
      setDestInputText(cached.destinationAddress);
      setTravelMode(cached.travelMode as TravelMode);
      setLivePath(cached.path);
      rawPathRef.current = [];
      setUserLocation(cached.path[cached.path.length - 1] || cached.startLocation);
      setIsTracking(true);
      toast({ title: "Resumed your trip", description: "We restored your active trip from before the reload." });
      return; // Skip the normal fresh-load flow below
    }

    const destName = searchParams.get('destinationName');
    const destLat = searchParams.get('destinationLat');
    const destLng = searchParams.get('destinationLng');
    const destAddress = searchParams.get('destinationAddress');
    if (destName && destLat && destLng && destAddress) {
      setDestInputText(destAddress);
      setDestinationPoint({ address: destAddress, location: { lat: parseFloat(destLat), lng: parseFloat(destLng) } });
    }
    fetchCurrentLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // DMS coordinate detection
  useEffect(() => {
    const dmsCoords = parseDMSToLatLng(startInputText);
    if (dmsCoords) {
      setStartPoint({ address: startInputText, location: dmsCoords });
    } else if (startInputText.trim() === '') {
      setStartPoint({ address: '', location: null });
    }
  }, [startInputText]);

  useEffect(() => {
    const dmsCoords = parseDMSToLatLng(destInputText);
    if (dmsCoords) {
      setDestinationPoint({ address: destInputText, location: dmsCoords });
    } else if (destInputText.trim() === '') {
      setDestinationPoint({ address: '', location: null });
    }
  }, [destInputText]);

  // Re-center map when points change but no route yet
  useEffect(() => {
    if (routes.length > 0) return;
    let pointToCenter: LatLng | null = null;
    if (startPoint.location && destinationPoint.location) {
      pointToCenter = {
        lat: (startPoint.location.lat + destinationPoint.location.lat) / 2,
        lng: (startPoint.location.lng + destinationPoint.location.lng) / 2,
      };
      setMapZoom(12);
    } else if (startPoint.location) {
      pointToCenter = startPoint.location;
      setMapZoom(15);
    } else if (destinationPoint.location) {
      pointToCenter = destinationPoint.location;
      setMapZoom(15);
    }
    if (pointToCenter) setMapCenter(pointToCenter);
  }, [startPoint.location, destinationPoint.location, routes.length]);

  // While actively tracking, follow the user's live position — Ola-style.
  useEffect(() => {
    if (!isTracking || !userLocation) return;
    setMapCenter(userLocation);
    setMapZoom(17);
  }, [isTracking, userLocation]);

  // Fetch routes when parameters change
  useEffect(() => {
    if (!startPoint.location || !destinationPoint.location) {
      if (routes.length > 0) {
        setRoutes([]);
        setRecommendation(null);
      }
      return;
    }

    let cancelled = false;
    setIsCalculating(true);
    setRoutes([]);
    setRecommendation(null);

    (async () => {
      try {
        const results = await getRoutes(travelMode, startPoint.location!, destinationPoint.location!);
        if (cancelled) return;

        if (results.length === 0) {
          toast({ variant: 'destructive', title: 'Could not calculate routes.' });
          setIsCalculating(false);
          return;
        }

        // Center map on the route
        const allPoints = results[0].path;
        if (allPoints.length > 0) {
          const lats = allPoints.map(p => p.lat);
          const lngs = allPoints.map(p => p.lng);
          setMapCenter({
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
            lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
          });
          setMapZoom(13);
        }

        // Get AI safety details for each route
        try {
          const detailsPromises = results.map(r => getRouteSafetyDetails({
            summary: r.summary,
            distance: formatDistance(r.distanceMeters),
            duration: formatDuration(r.durationSeconds),
          }));
          const allDetails = await Promise.all(detailsPromises);
          if (cancelled) return;

          const fullRoutes: FullRoute[] = results.map((r, i) => ({ ...r, details: { ...allDetails[i], isGenerated: true } }));
          setRoutes(fullRoutes);

          const rec = await recommendSafestRoute(allDetails);
          if (!cancelled) {
            setRecommendation({ index: rec.recommendedRouteIndex, reason: rec.reason });
            setSelectedRouteIndex(rec.recommendedRouteIndex);
          }
        } catch (e) {
          console.error("AI safety details failed:", e);
          setRoutes(results.map(r => ({ ...r })));
        }
      } catch (e) {
        console.error("Routing failed", e);
        if (!cancelled) toast({ variant: 'destructive', title: 'Could not calculate routes.' });
      } finally {
        if (!cancelled) setIsCalculating(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPoint.location, destinationPoint.location, travelMode]);

  // Live tracking
  useEffect(() => {
    if (!isTracking) {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    const processPath = async () => {
      if (rawPathRef.current.length === 0) return;
      const path_to_snap = [...(livePath.slice(-1)), ...rawPathRef.current];
      rawPathRef.current = [];
      try {
        const newSnappedPoints = await snapToRoad(path_to_snap);
        if (newSnappedPoints && newSnappedPoints.length > 0) {
          setLivePath(prev => {
            const prevPath = prev.length > 0 ? prev.slice(0, -1) : [];
            const updated = [...prevPath, ...newSnappedPoints];

            // Persist locally on every tick (cheap), but only write to Firestore every ~30s (quota-friendly).
            const cached = loadActiveTripLocally();
            if (cached) saveActiveTripLocally({ ...cached, path: updated });

            const now = Date.now();
            if (tripIdRef.current && now - lastProgressSaveRef.current > 30000) {
              lastProgressSaveRef.current = now;
              updateTripProgress(tripIdRef.current, updated, computePathDistance(updated));
            }

            return updated;
          });
        }
      } catch (e) {
        console.error("Failed to snap to road:", e);
      }
    };

    const snapInterval = setInterval(processPath, 5000);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const newLocation: LatLng = { lat: position.coords.latitude, lng: position.coords.longitude };
        setUserLocation(newLocation);
        rawPathRef.current.push(newLocation);
      },
      (err) => {
        // A single dropped GPS reading is common and shouldn't kill the whole tracking session —
        // only warn, don't stop tracking. Genuinely fatal errors (e.g. permission denied) still need attention.
        if (err.code === err.PERMISSION_DENIED) {
          toast({ variant: "destructive", title: "Location permission denied.", description: "Please enable location access to continue tracking." });
          setIsTracking(false);
        } else {
          console.warn("Transient location error:", err.message);
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
    return () => {
      clearInterval(snapInterval);
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [isTracking, toast, livePath]);

  const handleSwapLocations = () => {
    setStartPoint(destinationPoint);
    setDestinationPoint(startPoint);
    setStartInputText(destInputText);
    setDestInputText(startInputText);
  };

const handleStartTracking = async () => {
    if (isTracking) {
      // Stopping: finalize the trip in Firestore and clear the local cache.
      setIsTracking(false);
      if (tripIdRef.current) {
        const totalDistance = computePathDistance(livePath);
        const startedAt = loadActiveTripLocally()?.startedAt;
        const durationSeconds = startedAt ? (Date.now() - new Date(startedAt).getTime()) / 1000 : 0;
        await endTrip(tripIdRef.current, livePath, totalDistance, durationSeconds);
      }
      clearActiveTripLocally();
      tripIdRef.current = null;
    } else {
      if (routes.length === 0 || !startPoint.location || !destinationPoint.location) {
        toast({ variant: 'destructive', title: 'No route selected to start tracking.' });
        return;
      }
      const initialPath = userLocation ? [userLocation] : [];
      setLivePath(initialPath);
      rawPathRef.current = [];
      setIsTracking(true);

      const tripId = `trip-${Date.now()}`;
      tripIdRef.current = tripId;

      await startTrip({
        id: tripId,
        startAddress: startPoint.address,
        destinationAddress: destinationPoint.address,
        travelMode,
      });

      saveActiveTripLocally({
        tripId,
        startAddress: startPoint.address,
        startLocation: startPoint.location,
        destinationAddress: destinationPoint.address,
        destinationLocation: destinationPoint.location,
        travelMode,
        path: initialPath,
        startedAt: new Date().toISOString(),
      });
    }
  };

  const handleViewDetails = (route: FullRoute) => {
    if (!route.details) return;
    sessionStorage.setItem("selectedRouteData", JSON.stringify({ route, details: route.details }));
    router.push("/location/route-details");
  };

  const handleGeocodeInput = async (which: 'start' | 'destination') => {
    const text = which === 'start' ? startInputText : destInputText;
    const point = which === 'start' ? startPoint : destinationPoint;
    const setPoint = which === 'start' ? setStartPoint : setDestinationPoint;

    if ((point.location && point.address === text) || text === 'Your Location' || parseDMSToLatLng(text) || text.trim() === '') {
      return;
    }

    const result = await geocodeAddress(text);
    if (result) {
      setPoint(result);
    } else {
      toast({ variant: 'destructive', title: 'Location not found', description: `Could not find a location for "${text}".` });
    }
  };

  const handleShare = (type: 'contacts' | 'whatsapp' | 'email' | 'copy') => {
    if (!userLocation) {
      toast({ variant: 'destructive', title: "Location unavailable", description: "Cannot share without your current location." });
      return;
    }
    const shareUrl = `${window.location.origin}/location/fullscreen`;
    const shareText = `I'm sharing my live location with you via Femigo. You can see me here: ${shareUrl}`;

    if (type === 'copy') {
      navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link Copied!", description: "The live location link is now on your clipboard." });
    } else if (type === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
    } else if (type === 'email') {
      window.location.href = `mailto:?subject=My Live Location&body=${encodeURIComponent(shareText)}`;
    } else if (type === 'contacts') {
      const profile = JSON.parse(localStorage.getItem('femigo-user-profile') || '{}');
      const contacts: TrustedContact[] = profile.trustedContacts || [];
      if (contacts.length === 0) {
        toast({ variant: 'destructive', title: "No trusted contacts", description: "Please add trusted contacts in the Emergency section first." });
        return;
      }
      const phoneNumbers = contacts.map(c => c.phone).join(',');
      window.location.href = `sms:${phoneNumbers}?body=${encodeURIComponent(shareText)}`;
    }
    setIsShareOpen(false);
  };

  const travelModes = [
    { name: 'DRIVING' as TravelMode, icon: Car },
    { name: 'BICYCLING' as TravelMode, icon: Bike },
    { name: 'TRANSIT' as TravelMode, icon: TramFront },
    { name: 'WALKING' as TravelMode, icon: Footprints },
  ];

  const fastestIndex = routes.length > 0 ? routes.reduce((best, r, i) => r.durationSeconds < routes[best].durationSeconds ? i : best, 0) : -1;
  const shortestIndex = routes.length > 0 ? routes.reduce((best, r, i) => r.distanceMeters < routes[best].distanceMeters ? i : best, 0) : -1;

  return (
    <div className="w-full max-w-md mx-auto flex flex-col flex-1 bg-background">
      <Card className="w-full flex-1 flex flex-col rounded-none sm:rounded-2xl border-border bg-card shadow-2xl dark:shadow-black/50 overflow-hidden my-0 sm:my-4">
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0 p-4 border-b border-border shrink-0">
          <div className='flex items-center gap-4'>
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" className="text-foreground hover:bg-accent rounded-full">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-1 text-2xl font-bold text-foreground">
              Femigo
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-primary">
                <path d="M12 21.35L10.55 20.03C5.4 15.36 2 12.28 2 8.5C2 5.42 4.42 3 7.5 3C9.24 3 10.91 3.81 12 5.09C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.42 22 8.5C22 12.28 18.6 15.36 13.45 20.04L12 21.35Z" fill="currentColor"/>
              </svg>
            </div>
          </div>
          <Link href="/location/history">
            <Button variant="ghost" size="icon" className="text-foreground hover:bg-accent rounded-full">
              <Clock className="h-5 w-5" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          <div className={cn("shrink-0 p-4 space-y-4", isTracking && "hidden")}>
            <div className="flex flex-col items-center gap-2">
              <AddressAutocomplete
                value={startInputText}
                onChange={setStartInputText}
                onSelect={(s) => { setStartPoint(s); setStartInputText(s.address); }}
                placeholder="Start location or coordinates"
                className="pl-9 pr-10 bg-muted/20 dark:bg-card"
                icon={<Circle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />}
                rightSlot={
                  <Button type="button" variant="ghost" size="icon" onClick={fetchCurrentLocation} className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full z-10" disabled={isFetchingLocation}>
                    {isFetchingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4 text-primary" />}
                  </Button>
                }
              />

              <Button variant="outline" size="icon" onClick={handleSwapLocations} className="h-8 w-8 rounded-full">
                <ArrowRightLeft className="h-4 w-4"/>
              </Button>

              <AddressAutocomplete
                value={destInputText}
                onChange={setDestInputText}
                onSelect={(s) => { setDestinationPoint(s); setDestInputText(s.address); }}
                placeholder="Destination or coordinates"
                className="pl-9 bg-muted/20 dark:bg-card"
                icon={<MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary z-10" />}
              />
            </div>

            <div className="flex items-center justify-around bg-muted p-1 rounded-full">
              {travelModes.map((mode) => (
                <Button
                  key={mode.name}
                  variant="ghost"
                  className={cn("flex-1 rounded-full text-muted-foreground hover:text-foreground capitalize", travelMode === mode.name && "bg-primary/80 text-white hover:bg-primary/90 dark:text-primary-foreground")}
                  onClick={() => setTravelMode(mode.name)}
                >
                  <mode.icon className="h-5 w-5" />
                </Button>
              ))}
            </div>
            {travelMode === 'TRANSIT' && (
              <p className="text-xs text-amber-500 -mt-2">Bus times are approximate — real-time transit schedules aren't available yet.</p>
            )}
          </div>

          <div className="relative flex-1 w-full overflow-hidden min-h-0">
            <MapContainer center={[mapCenter.lat, mapCenter.lng] as any} zoom={mapZoom} style={{ height: '100%', width: '100%' }} zoomControl={false}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapUpdater center={[mapCenter.lat, mapCenter.lng]} zoom={mapZoom} />
              {userLocation && userIcon && <Marker position={[userLocation.lat, userLocation.lng] as any} icon={userIcon} />}
              {startPoint.location && startIcon && <Marker position={[startPoint.location.lat, startPoint.location.lng] as any} icon={startIcon} />}
              {destinationPoint.location && destIcon && <Marker position={[destinationPoint.location.lat, destinationPoint.location.lng] as any} icon={destIcon} />}
              {routes.map((route, index) => (
                <Polyline
                  key={index}
                  positions={route.path.map(p => [p.lat, p.lng]) as any}
                  pathOptions={{
                    color: index === selectedRouteIndex ? '#ec4899' : '#808080',
                    weight: index === selectedRouteIndex ? 6 : 4,
                    opacity: index === selectedRouteIndex ? 0.9 : 0.5,
                    dashArray: index === selectedRouteIndex ? undefined : '6 8',
                  }}
                  eventHandlers={{ click: () => setSelectedRouteIndex(index) }}
                />
              ))}
              {isTracking && livePath.length > 1 && (
                <Polyline positions={livePath.map(p => [p.lat, p.lng]) as any} pathOptions={{ color: '#0000FF', weight: 6, opacity: 0.9 }} />
              )}
            </MapContainer>

            <Link href="/location/fullscreen" className="absolute top-2 right-2 z-[401]">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 rounded-full bg-black/30 backdrop-blur-sm">
                <Maximize className="h-5 w-5" />
              </Button>
            </Link>

            {isCalculating && (
              <div className="absolute inset-0 z-[401] flex items-center justify-center bg-background/50 backdrop-blur-sm">
                <div className="text-center space-y-4 text-foreground">
                  <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
                  <h2 className="text-xl font-bold">Calculating Routes...</h2>
                </div>
              </div>
            )}
          </div>

          {isTracking && (
            <div className="shrink-0 p-4 border-t border-border flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Heading to</p>
                <p className="font-semibold text-foreground truncate max-w-[200px]">{destinationPoint.address}</p>
              </div>
              <Button onClick={handleStartTracking} variant="destructive" className="rounded-full px-6">
                STOP
              </Button>
            </div>
          )}

          <div className={cn("flex flex-col shrink-0 overflow-y-auto max-h-[45vh]", isTracking && "hidden")}>
            {routes.length > 0 && !isTracking && (
              <div className="flex flex-col gap-3 p-4 border-t border-border">
                <h3 className="font-bold text-lg text-foreground">Select a Route</h3>
                {recommendation && (
                  <div className="p-3 rounded-lg bg-green-900/50 border border-green-500/50 text-sm">
                    <p className="font-bold text-green-300">AI Recommendation</p>
                    <p className="text-white/80">{recommendation.reason}</p>
                  </div>
                )}
                <div className="flex flex-col gap-3 pr-2">
                  {routes.map((route, index) => (
                    <div key={index} onClick={() => setSelectedRouteIndex(index)} className={cn(
                      "p-4 rounded-xl cursor-pointer border-2 transition-all relative",
                      selectedRouteIndex === index ? "bg-primary/20 border-primary shadow-lg shadow-primary/20" : "border-border bg-card hover:bg-accent"
                    )}>
                      <div className="flex gap-2 flex-wrap mb-2">
                        {recommendation && index === recommendation.index && <Badge className="bg-green-500 text-white border-none">AI Recommended</Badge>}
                        {index === fastestIndex && <Badge variant="secondary">Fastest</Badge>}
                        {index === shortestIndex && <Badge variant="secondary">Shortest</Badge>}
                        {route.isApproximate && <Badge variant="outline" className="text-amber-500 border-amber-500">Approximate</Badge>}
                      </div>
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <p className="font-bold text-base text-foreground">{route.summary}</p>
                          <p className="text-sm text-muted-foreground">{formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}</p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          onClick={(e) => { e.stopPropagation(); handleViewDetails(route); }}
                          disabled={!route.details}
                        >
                          More Info
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4 p-4 border-t border-border">
              <Button onClick={handleStartTracking} className="w-full py-6 text-lg font-bold rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50" disabled={routes.length === 0 || isCalculating}>
                {isTracking ? "STOP" : "START"}
              </Button>
              <div className="flex justify-around items-center bg-muted p-2 rounded-2xl">
                <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" className="text-foreground font-semibold disabled:opacity-50" disabled={isTracking}>
                      <Share2 className="mr-2 h-5 w-5 text-primary" />
                      Share Live Location
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Share Your Location</DialogTitle>
                      <DialogDescription>
                        Choose how you want to share a link to your live location. Anyone with the link can see where you are.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4 pt-4">
                      <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => handleShare('contacts')}>
                        <Users className="h-6 w-6" /> Trusted Contacts
                      </Button>
                      <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => handleShare('whatsapp')}>
                        <MessageSquare className="h-6 w-6" /> WhatsApp
                      </Button>
                      <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => handleShare('email')}>
                        <Mail className="h-6 w-6" /> Email
                      </Button>
                      <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => handleShare('copy')}>
                        <Copy className="h-6 w-6" /> Copy Link
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Button variant="ghost" className="text-foreground font-semibold disabled:opacity-50" disabled={isTracking} onClick={handleStartTracking}>
                  <Footprints className="mr-2 h-5 w-5 text-primary" />
                  Track Me
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LocationPage() {
  return (
    <main className="h-screen w-full flex flex-col bg-background">
      <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
        <LocationPlanner />
      </Suspense>
    </main>
  );
}
