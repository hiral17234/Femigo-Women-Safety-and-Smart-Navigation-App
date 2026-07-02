
'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Car, Bike, TramFront, Footprints, ArrowRightLeft, Share2, MapPin, Circle, Loader2, Maximize, Users, MessageSquare, Mail, Copy, LocateFixed } from 'lucide-react';
import { APIProvider, Map, AdvancedMarker, useMapsLibrary, useMap } from '@vis.gl/react-google-maps';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { snapToRoad } from '@/app/actions/snap-to-road';
import { getRouteSafetyDetails } from '@/ai/flows/route-safety-flow';
import { recommendSafestRoute } from '@/ai/flows/recommend-safest-route-flow';
import { Badge } from '@/components/ui/badge';
import { geocodeAddress } from '../actions/geocode-address';
import { type RouteSafetyOutput } from '@/ai/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { reverseGeocode } from '../actions/reverse-geocode';


const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

type Point = { lat: number; lng: number };
type Place = { address: string; location: Point | null };
type TravelMode = 'DRIVING' | 'BICYCLING' | 'TRANSIT' | 'WALKING';
type RouteDetail = RouteSafetyOutput & { isGenerated?: boolean };
type TrustedContact = { id: string; name: string; phone: string; };


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
  } catch (e) {
    return null;
  }
}

// A custom marker component that pulses
const UserMarker = () => (
    <div className="relative flex h-5 w-5 items-center justify-center">
      <div className="absolute h-full w-full animate-ping rounded-full bg-blue-500/70" />
      <div className="relative h-3 w-3 rounded-full border-2 border-white bg-blue-500" />
    </div>
);

const StartPointMarker = () => (
    <div className="text-green-500">
        <MapPin className="h-8 w-8 drop-shadow-lg" fill="currentColor" stroke="white" strokeWidth={1.5} />
    </div>
);

const DestinationPointMarker = () => (
    <div className="text-red-500">
        <MapPin className="h-8 w-8 drop-shadow-lg" fill="currentColor" stroke="white" strokeWidth={1.5} />
    </div>
);

/**
 * Renders the route polylines on the map.
 * @param routes - The array of routes from the Directions Service.
 * @param selectedRouteIndex - The index of the currently selected route.
 * @param onRouteClick - Handler for when a route is clicked.
 */
const RoutePolylines = ({ routes, selectedRouteIndex, onRouteClick }: { routes: google.maps.DirectionsRoute[], selectedRouteIndex: number, onRouteClick: (index: number) => void }) => {
    const map = useMap();
    const polylinesRef = useRef<google.maps.Polyline[]>([]);

    useEffect(() => {
        if (!map || !window.google?.maps?.Polyline) return;

        // Clear previous polylines
        polylinesRef.current.forEach(polyline => polyline.setMap(null));
        polylinesRef.current = [];

        if (!routes) return;
        
        routes.forEach((route, index) => {
            const isSelected = index === selectedRouteIndex;
            // Dashed line symbol for alternate routes
            const lineSymbol = {
                path: 'M 0,-1 0,1',
                strokeOpacity: 1,
                scale: 4,
            };

            const polyline = new window.google.maps.Polyline({
                path: route.overview_path,
                geodesic: true,
                strokeColor: isSelected ? 'hsl(var(--primary))' : '#808080',
                strokeOpacity: isSelected ? 0.9 : 0.7,
                strokeWeight: isSelected ? 8 : 6,
                zIndex: isSelected ? 2 : 1,
                icons: isSelected ? undefined : [{
                    icon: lineSymbol,
                    offset: '0',
                    repeat: '20px'
                }],
                map: map,
            });

            polyline.addListener('click', () => {
                onRouteClick(index);
            });

            polylinesRef.current.push(polyline);
        });

        // Cleanup function to remove polylines from map when component unmounts or dependencies change
        return () => {
            polylinesRef.current.forEach(polyline => polyline.setMap(null));
        }

    }, [map, routes, selectedRouteIndex, onRouteClick]);

    return null;
}

/**
 * Renders the user's live tracked path on the map.
 * @param path - An array of points representing the user's path.
 */
const LiveTrackingPolyline = ({ path }: { path: Point[] }) => {
    const map = useMap();
    const polylineRef = useRef<google.maps.Polyline | null>(null);

    useEffect(() => {
        if (!map || !window.google?.maps?.Polyline) return;

        if (!polylineRef.current) {
            polylineRef.current = new window.google.maps.Polyline({
                path: path,
                strokeColor: '#0000FF', // Blue
                strokeOpacity: 0.9,
                strokeWeight: 8,
                zIndex: 3, // Ensure it's on top of other route lines
                map: map,
            });
        } else {
             polylineRef.current.setPath(path);
        }
    }, [map, path]);
    
    // Cleanup on unmount
    useEffect(() => {
        const polyline = polylineRef.current;
        return () => {
            if (polyline) {
                polyline.setMap(null);
            }
        };
    }, []);

    return null;
}

function LocationPlanner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [userLocation, setUserLocation] = useState<Point | null>(null);
  const [mapCenter, setMapCenter] = useState<Point>({ lat: 20.5937, lng: 78.9629 });
  const [mapZoom, setMapZoom] = useState(4);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [travelMode, setTravelMode] = useState<TravelMode>('WALKING');

  // We need to keep the raw text input separate from the validated location object
  const [startInputText, setStartInputText] = useState('');
  const [destInputText, setDestInputText] = useState('');

  const [startPoint, setStartPoint] = useState<Place>({ address: "", location: null });
  const [destinationPoint, setDestinationPoint] = useState<Place>({ address: "", location: null });
  
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeDetails, setRouteDetails] = useState<RouteDetail[]>([]);
  const [recommendation, setRecommendation] = useState<{ index: number; reason: string } | null>(null);

  const [isTracking, setIsTracking] = useState(false);
  const [livePath, setLivePath] = useState<Point[]>([]);
  const rawPathRef = useRef<Point[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const isRecalculatingRef = useRef(false);

  const startInputRef = useRef<HTMLInputElement>(null);
  const destinationInputRef = useRef<HTMLInputElement>(null);
  
  const [isShareOpen, setIsShareOpen] = useState(false);

  const placesLibrary = useMapsLibrary('places');
  const routesLibrary = useMapsLibrary('routes');
  const geometryLibrary = useMapsLibrary('geometry');

  const handleSetCurrentLocation = useCallback(async (location: Point) => {
    setUserLocation(location);
    setIsFetchingLocation(true);
    try {
        const address = await reverseGeocode(location);
        setStartPoint({ address: address, location: location });
        setStartInputText(address);
    } catch {
        setStartPoint({ address: "Your Location", location: location });
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
            const newLocation: Point = { lat: position.coords.latitude, lng: position.coords.longitude };
            handleSetCurrentLocation(newLocation);
            toast.dismiss();
        },
        () => {
            toast({ variant: 'destructive', title: 'Could not get your location.', description: "Please enable location services and try again." });
            setIsFetchingLocation(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}, [handleSetCurrentLocation, toast]);

  // Effect to get user's location once, and handle incoming route data from query params
  useEffect(() => {
    const destName = searchParams.get('destinationName');
    const destLat = searchParams.get('destinationLat');
    const destLng = searchParams.get('destinationLng');
    const destAddress = searchParams.get('destinationAddress');
    
    if (destName && destLat && destLng && destAddress) {
        setDestInputText(destAddress);
        setDestinationPoint({
            address: destAddress,
            location: { lat: parseFloat(destLat), lng: parseFloat(destLng) }
        });
    }

    // Try to get location automatically once on load
    fetchCurrentLocation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Effect to handle coordinate input for start point
  useEffect(() => {
    const dmsCoords = parseDMSToLatLng(startInputText);
    if (dmsCoords) {
        setStartPoint({ address: startInputText, location: dmsCoords });
        if (directions) {
            setDirections(null);
            setRouteDetails([]);
            setRecommendation(null);
        }
    } else if (startInputText.trim() === '') {
        setStartPoint({ address: '', location: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInputText]);

  // Effect to handle coordinate input for destination point
  useEffect(() => {
    const dmsCoords = parseDMSToLatLng(destInputText);
    if (dmsCoords) {
        setDestinationPoint({ address: destInputText, location: dmsCoords });
        if (directions) {
            setDirections(null);
            setRouteDetails([]);
            setRecommendation(null);
        }
    } else if (destInputText.trim() === '') {
        setDestinationPoint({ address: '', location: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destInputText]);


  // Effect to initialize Google Places Autocomplete.
  useEffect(() => {
    if (!placesLibrary || !startInputRef.current || !destinationInputRef.current) return;

    const startAutocomplete = new placesLibrary.Autocomplete(startInputRef.current, { fields: ['geometry.location', 'formatted_address', 'name'] });
    const destinationAutocomplete = new placesLibrary.Autocomplete(destinationInputRef.current, { fields: ['geometry.location', 'formatted_address', 'name'] });

    const startListener = startAutocomplete.addListener('place_changed', () => {
      const place = startAutocomplete.getPlace();
      if (place.geometry?.location) {
          const newLocation = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
          const newAddress = place.formatted_address || place.name || '';
          setStartPoint({ address: newAddress, location: newLocation });
          setStartInputText(newAddress);
      }
    });
    
    const destListener = destinationAutocomplete.addListener('place_changed', () => {
      const place = destinationAutocomplete.getPlace();
      if (place.geometry?.location) {
          const newLocation = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
          const newAddress = place.formatted_address || place.name || '';
          setDestinationPoint({ address: newAddress, location: newLocation });
          setDestInputText(newAddress);
      }
    });

    return () => {
        startListener.remove();
        destListener.remove();
    }
  }, [placesLibrary]);

  // Effect to re-center the map when a single point is entered or both are entered but no route yet.
  useEffect(() => {
      if (directions) return; // Don't re-center if we have a route.
      
      let pointToCenter: Point | null = null;
      let zoomLevel = 15;

      if (startPoint.location && destinationPoint.location) {
          if (window.google?.maps?.LatLngBounds) {
            const bounds = new window.google.maps.LatLngBounds();
            bounds.extend(startPoint.location);
            bounds.extend(destinationPoint.location);
            const tempMapEl = document.createElement('div');
            tempMapEl.style.width = '100px'; tempMapEl.style.height = '100px';
            const newMap = new window.google.maps.Map(tempMapEl);
            newMap.fitBounds(bounds);
            zoomLevel = newMap.getZoom() ?? 12;
            pointToCenter = bounds.getCenter().toJSON();
          }
      } else if (startPoint.location) {
          pointToCenter = startPoint.location;
      } else if (destinationPoint.location) {
          pointToCenter = destinationPoint.location;
      }

      if (pointToCenter) {
          setMapCenter(pointToCenter);
          setMapZoom(zoomLevel);
      }
  }, [startPoint.location, destinationPoint.location, directions]);


  // Effect to fetch directions when route parameters change.
  useEffect(() => {
    if (!routesLibrary || !startPoint.location || !destinationPoint.location) {
      if (directions) {
          setDirections(null);
          setRouteDetails([]);
          setRecommendation(null);
      }
      return;
    }
    const directionsService = new routesLibrary.DirectionsService();
    setIsCalculating(true);
    setDirections(null);
    setRouteDetails([]);
    setRecommendation(null);
    
    directionsService.route({
        origin: startPoint.location,
        destination: destinationPoint.location,
        travelMode: travelMode as google.maps.TravelMode,
        provideRouteAlternatives: true,
    }).then(async response => {
        setDirections(response);

        if(response.routes.length > 0) {
            if (response.routes[0].bounds && window.google?.maps) {
                const bounds = response.routes[0].bounds;
                const tempMapEl = document.createElement('div');
                tempMapEl.style.width = '100px'; tempMapEl.style.height = '100px';
                const newMap = new window.google.maps.Map(tempMapEl);
                newMap.fitBounds(bounds);
                setMapZoom(newMap.getZoom() ?? 12);
                setMapCenter(bounds.getCenter().toJSON());
            }

            // Generate safety details for all routes
            try {
                const detailsPromises = response.routes.map(route => getRouteSafetyDetails({
                    summary: route.summary,
                    distance: route.legs[0].distance?.text || 'N/A',
                    duration: route.legs[0].duration?.text || 'N/A',
                }));
                const allDetails = await Promise.all(detailsPromises);
                const generatedDetails = allDetails.map(d => ({ ...d, isGenerated: true }));
                setRouteDetails(generatedDetails);

                // Now get the recommendation
                if (generatedDetails.length > 0) {
                    const rec = await recommendSafestRoute(generatedDetails);
                    setRecommendation({ index: rec.recommendedRouteIndex, reason: rec.reason });
                    setSelectedRouteIndex(rec.recommendedRouteIndex);
                }
            } catch (e) {
                console.error("AI safety details or recommendation failed:", e);
                // Fallback to basic info if AI fails
                const fallbackDetails = response.routes.map(() => ({
                    roadQuality: 'Moderate', incidents: 'N/A', reviewsCount: 0, lighting: 'Partially-lit', crowdedness: 'Medium',
                    safetySummary: 'Could not load AI safety details.', crimeSummary: '', policeInfo: '', weatherInfo: '', isGenerated: false,
                }));
                setRouteDetails(fallbackDetails);
            }
        }
        setIsCalculating(false);
        setTimeout(() => { isRecalculatingRef.current = false; }, 2000);

    }).catch(e => {
        console.error("Directions request failed", e);
        toast({ variant: 'destructive', title: 'Could not calculate routes.' });
        setIsCalculating(false);
        setTimeout(() => { isRecalculatingRef.current = false; }, 2000);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesLibrary, startPoint.location, destinationPoint.location, travelMode]);
  
  // Effect to manage live location tracking
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
                    return [...prevPath, ...newSnappedPoints];
                });
            }
        } catch (e) { console.error("Failed to snap to road:", e); }
    };

    const snapInterval = setInterval(processPath, 5000);

    watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
            const newLocation: Point = { lat: position.coords.latitude, lng: position.coords.longitude };
            setUserLocation(newLocation);
            rawPathRef.current.push(newLocation);

            // Off-route check
            if (geometryLibrary && directions && directions.routes.length > selectedRouteIndex && window.google?.maps?.geometry && !isRecalculatingRef.current) {
                const routePath = new window.google.maps.Polyline({
                    path: directions.routes[selectedRouteIndex].overview_path,
                });
                
                const onRoute = window.google.maps.geometry.poly.isLocationOnEdge(
                    new window.google.maps.LatLng(newLocation.lat, newLocation.lng),
                    routePath,
                    0.001 // ~111 meters tolerance
                );

                if (!onRoute) {
                    isRecalculatingRef.current = true;
                    toast({ variant: "destructive", title: "You are off-route!", description: "Recalculating..." });
                    setStartPoint({ address: "Your Location", location: newLocation });
                    setStartInputText("Your Location");
                }
            }
        },
        () => {
            toast({ variant: "destructive", title: "Could not get your location." });
            setIsTracking(false);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
    
    return () => {
        clearInterval(snapInterval);
        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
        }
    };
  }, [isTracking, directions, selectedRouteIndex, geometryLibrary, toast, livePath]);


  const handleSwapLocations = () => {
    setStartPoint(destinationPoint);
    setDestinationPoint(startPoint);
    setStartInputText(destInputText);
    setDestInputText(startInputText);
  };
  
  const handleStartTracking = () => {
      if (isTracking) {
        setIsTracking(false);
      } else {
         if (!directions?.routes[selectedRouteIndex]) {
            toast({ variant: 'destructive', title: 'No route selected to start tracking.' });
            return;
        }
        setLivePath(userLocation ? [userLocation] : []);
        rawPathRef.current = [];
        setIsTracking(true);
      }
  }

  const handleViewDetails = async (route: google.maps.DirectionsRoute, index: number) => {
    const currentDetails = routeDetails[index];

    // If details are already generated, navigate directly
    if (currentDetails.isGenerated) {
      sessionStorage.setItem("selectedRouteData", JSON.stringify({ route, details: currentDetails }));
      router.push("/location/route-details");
      return;
    }

    toast({ title: 'Generating AI Safety Insights...', description: 'This may take a moment.' });
    
    try {
      const details = await getRouteSafetyDetails({
        summary: route.summary,
        distance: route.legs[0].distance?.text || 'N/A',
        duration: route.legs[0].duration?.text || 'N/A',
      });
      
      const newRouteDetails = [...routeDetails];
      newRouteDetails[index] = { ...details, isGenerated: true };
      setRouteDetails(newRouteDetails);

      sessionStorage.setItem("selectedRouteData", JSON.stringify({ route, details }));
      router.push("/location/route-details");

    } catch(e) {
      console.error("Safety detail generation failed:", e);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not generate safety details for this route.' });
    }
  };

  const handleGeocodeInput = async (which: 'start' | 'destination') => {
    const text = which === 'start' ? startInputText : destInputText;
    const point = which === 'start' ? startPoint : destinationPoint;
    const setPoint = which === 'start' ? setStartPoint : setDestinationPoint;

    // Don't geocode if we already have a location for this exact text,
    // or if it's "Your Location", or if it's a valid coordinate string, or empty.
    if ((point.location && point.address === text) || text === 'Your Location' || parseDMSToLatLng(text) || text.trim() === '') {
        return;
    }
    
    try {
        const location = await geocodeAddress(text);
        if (location) {
            setPoint({ address: text, location });
        } else {
            toast({
                variant: 'destructive',
                title: 'Location not found',
                description: `Could not find a location for "${text}".`,
            });
        }
    } catch (error) {
         toast({
            variant: 'destructive',
            title: 'Geocoding Error',
            description: 'Could not look up the address.',
        });
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
      { name: 'DRIVING', icon: Car },
      { name: 'BICYCLING', icon: Bike },
      { name: 'TRANSIT', icon: TramFront },
      { name: 'WALKING', icon: Footprints },
  ]

  const onRouteClick = (index: number) => {
    setSelectedRouteIndex(index);
  }

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
        </CardHeader>
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
            <div className="shrink-0 p-4 space-y-4">
              <div className="flex flex-col items-center gap-2">
                  <div className="relative w-full">
                      <Circle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input 
                        ref={startInputRef} 
                        value={startInputText} 
                        onChange={(e) => setStartInputText(e.target.value)} 
                        onBlur={() => handleGeocodeInput('start')}
                        onFocus={() => setTimeout(() => {
                           if (startInputText === 'Your Location') {
                               setStartInputText('');
                           }
                        }, 100)} 
                        className="pl-9 pr-10 bg-muted/20 dark:bg-card" placeholder="Start location or coordinates" />
                       <Button type="button" variant="ghost" size="icon" onClick={fetchCurrentLocation} className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full" disabled={isFetchingLocation}>
                         {isFetchingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4 text-primary" />}
                       </Button>
                  </div>

                  <Button variant="outline" size="icon" onClick={handleSwapLocations} className="h-8 w-8 rounded-full">
                      <ArrowRightLeft className="h-4 w-4"/>
                  </Button>

                  <div className="relative w-full">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                      <Input 
                          ref={destinationInputRef} 
                          value={destInputText} 
                          onChange={(e) => setDestInputText(e.target.value)}
                          onBlur={() => handleGeocodeInput('destination')}
                          className="pl-9 bg-muted/20 dark:bg-card" placeholder="Destination or coordinates" />
                  </div>
              </div>
              
              <div className="flex items-center justify-around bg-muted p-1 rounded-full">
                  {travelModes.map((mode) => (
                      <Button 
                          key={mode.name}
                          variant="ghost" 
                          className={cn("flex-1 rounded-full text-muted-foreground hover:text-foreground capitalize", travelMode === mode.name && "bg-primary/80 text-white hover:bg-primary/90 dark:text-primary-foreground")}
                          onClick={() => setTravelMode(mode.name as TravelMode)}
                      >
                        <mode.icon className="h-5 w-5" />
                      </Button>
                  ))}
              </div>
            </div>

            <div className="relative flex-1 w-full overflow-hidden min-h-0">
                <Map center={mapCenter} zoom={mapZoom} gestureHandling={'greedy'} disableDefaultUI={true} mapId="a2b4a5d6e7f8g9h0" onCenterChanged={(e) => setMapCenter(e.detail.center)}>
                    {userLocation && <AdvancedMarker position={userLocation} zIndex={5}><UserMarker /></AdvancedMarker>}
                    {startPoint.location && <AdvancedMarker position={startPoint.location} zIndex={4}><StartPointMarker /></AdvancedMarker>}
                    {destinationPoint.location && <AdvancedMarker position={destinationPoint.location} zIndex={4}><DestinationPointMarker /></AdvancedMarker>}
                    {directions && <RoutePolylines routes={directions.routes} selectedRouteIndex={selectedRouteIndex} onRouteClick={onRouteClick} />}
                    {isTracking && <LiveTrackingPolyline path={livePath} />}
                </Map>
                <Link href="/location/fullscreen" className="absolute top-2 right-2 z-10">
                    <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 rounded-full bg-black/30 backdrop-blur-sm">
                        <Maximize className="h-5 w-5" />
                    </Button>
                </Link>
                 {isCalculating && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                      <div className="text-center space-y-4 text-foreground">
                          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
                          <h2 className="text-xl font-bold">Calculating Routes...</h2>
                      </div>
                  </div>
                )}
            </div>
            
            <div className="flex flex-col shrink-0 overflow-y-auto max-h-[45vh]">
              {directions && directions.routes.length > 0 && routeDetails.length > 0 && (
                  <div className="flex flex-col gap-3 p-4 border-t border-border">
                      <h3 className="font-bold text-lg text-foreground">Select a Route</h3>
                      {recommendation && (
                          <div className="p-3 rounded-lg bg-green-900/50 border border-green-500/50 text-sm">
                              <p className="font-bold text-green-300">AI Recommendation</p>
                              <p className="text-white/80">{recommendation.reason}</p>
                          </div>
                      )}
                      <div className="flex flex-col gap-3 pr-2">
                          {directions.routes.map((route, index) => {
                              const details = routeDetails[index];
                              if (!details) return null;
                              const isRecommended = recommendation && index === recommendation.index;
                              return (
                                  <div key={index} onClick={() => onRouteClick(index)} className={cn(
                                      "p-4 rounded-xl cursor-pointer border-2 transition-all relative",
                                      selectedRouteIndex === index ? "bg-primary/20 border-primary shadow-lg shadow-primary/20" : "border-border bg-card hover:bg-accent"
                                  )}>
                                      {isRecommended && (
                                          <Badge className="absolute -top-2 -right-2 bg-green-500 text-white border-none">Recommended</Badge>
                                      )}
                                      <div className="flex justify-between items-start gap-4">
                                        <div>
                                          <p className="font-bold text-base text-foreground">{route.summary || `Route ${index + 1}`}</p>
                                          <p className="text-sm text-muted-foreground">{route.legs[0].distance?.text} · {route.legs[0].duration?.text}</p>
                                        </div>
                                          <Button 
                                              variant="secondary" 
                                              size="sm" 
                                              className="shrink-0"
                                              onClick={(e) => {
                                                  e.stopPropagation(); // Prevent route selection
                                                  handleViewDetails(route, index);
                                              }}
                                          >
                                              More Info
                                          </Button>
                                      </div>
                                  </div>
                              )
                          })}
                      </div>
                  </div>
              )}

              <div className="flex flex-col gap-4 p-4 border-t border-border">
                  <Button onClick={handleStartTracking} className="w-full py-6 text-lg font-bold rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50" disabled={!directions || isCalculating}>
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
  if (!GOOGLE_MAPS_API_KEY) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-background p-4 text-center">
            <div className="rounded-lg bg-card p-8 text-card-foreground">
                <h1 className="text-xl font-bold text-destructive">Configuration Error</h1>
                <p className="mt-2 text-muted-foreground">Google Maps API Key is missing. Please add <code className="font-mono bg-muted px-1 py-0.5 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to your environment variables.</p>
            </div>
        </div>
    );
  }

  return (
    <main className="h-screen w-full flex flex-col bg-background">
       <APIProvider apiKey={GOOGLE_MAPS_API_KEY as string} libraries={['marker', 'places', 'routes', 'geometry', 'geocoding']}>
        <Suspense fallback={
          <div className="flex h-screen w-full items-center justify-center bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }>
          <LocationPlanner />
        </Suspense>
      </APIProvider>
    </main>
  );
}
