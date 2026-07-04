
'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Route, AlertTriangle, MessageSquare, Lamp, Users, ShieldCheck, Cloudy, Building, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { type RouteSafetyOutput as RouteDetail } from '@/ai/types';
import { formatDistance, formatDuration } from '@/lib/mapping';

function RouteDetailsContent() {
    const router = useRouter();
    const [routeData, setRouteData] = useState<{ route: any; details: RouteDetail } | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        try {
            const storedData = sessionStorage.getItem('selectedRouteData');
            if (storedData) {
                setRouteData(JSON.parse(storedData));
            }
        } catch (error) {
            console.error("Failed to parse route data from session storage", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    if (isLoading) {
        return <RouteDetailsSkeleton />;
    }

    if (!routeData) {
        return (
            <div className="text-center text-white bg-card p-8 rounded-lg shadow-lg">
                <h2 className="text-xl font-bold text-destructive">No Route Data Found</h2>
                <p className="mt-2 text-muted-foreground">This can happen if you refresh the page or navigate here directly. Please go back and select a route.</p>
                <Button onClick={() => router.push('/location')} className="mt-6">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Planner
                </Button>
            </div>
        );
    }
    
    const { route, details } = routeData;
    
    const safetyScore = details.reviewsCount > 50 ? 85 : 65;

    const InfoRow = ({ icon: Icon, label, value, valueClass }: { icon: React.ElementType, label: string, value: string, valueClass?: string }) => (
        <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-primary" />
                <span className="text-white/80">{label}</span>
            </div>
            <span className={`font-semibold ${valueClass}`}>{value}</span>
        </div>
    );

    const PlaceholderSection = ({ icon: Icon, title, text }: { icon: React.ElementType, title: string, text: string }) => (
        <div className="rounded-lg bg-black/30 p-4">
            <div className="flex items-center gap-3 mb-2">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-white">{title}</h3>
            </div>
            <p className="text-sm text-white/60">{text}</p>
        </div>
    );

    return (
        <div className="w-full max-w-md mx-auto">
            <Button onClick={() => router.push('/location')} variant="ghost" className="mb-4 inline-flex items-center gap-2 text-sm text-purple-300/70 transition-colors hover:text-purple-300">
                <ArrowLeft className="h-4 w-4" />
                Back to Planner
            </Button>
            <Card className="w-full rounded-2xl border border-white/10 bg-black/20 p-6 shadow-2xl shadow-pink-500/10 backdrop-blur-xl text-white">
                <CardHeader className="text-center p-0 pb-6">
                    <CardTitle className="text-2xl font-bold tracking-tight">Route Details</CardTitle>
                    <CardDescription className="text-purple-200/70">
{route.summary} ({formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)})
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0 space-y-6">
                    <div className="text-center rounded-xl bg-gradient-to-br from-primary/20 to-purple-600/20 p-4 border border-primary/30">
                        <p className="text-sm font-medium text-purple-200/80">Overall Safety Score</p>
                        <p className="text-5xl font-bold text-white mt-1">{safetyScore}/100</p>
                    </div>

                    <div className="space-y-1">
                        <InfoRow icon={Route} label="Road Quality" value={details.roadQuality} />
                        <Separator className="bg-white/10" />
                        <InfoRow icon={AlertTriangle} label="Historical Incidents" value={details.incidents} />
                        <Separator className="bg-white/10" />
                        <InfoRow icon={MessageSquare} label="User Reviews" value={`${details.reviewsCount} reviews`} />
                         <Separator className="bg-white/10" />
                        <InfoRow icon={Lamp} label="Lighting Condition" value={details.lighting} />
                         <Separator className="bg-white/10" />
                        <InfoRow icon={Users} label="Crowdedness" value={`${details.crowdedness} Traffic`} />
                    </div>

                    <div className="space-y-4">
                        <PlaceholderSection 
                            icon={ShieldCheck}
                            title="Area Crime Reports"
                            text={details.crimeSummary}
                        />
                        <PlaceholderSection 
                            icon={ShieldAlert}
                            title="User-Submitted Alerts"
                            text="No recent user-submitted alerts for this route."
                        />
                        <PlaceholderSection 
                            icon={Building}
                            title="Local Police Station"
                            text={details.policeInfo}
                        />
                         <PlaceholderSection 
                            icon={Cloudy}
                            title="Weather & Visibility"
                            text={details.weatherInfo}
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function RouteDetailsSkeleton() {
    return (
         <div className="w-full max-w-md mx-auto">
            <Skeleton className="h-6 w-32 mb-4" />
            <Card className="w-full rounded-2xl border border-white/10 bg-black/20 p-6 shadow-2xl shadow-pink-500/10 backdrop-blur-xl text-white">
                <CardHeader className="text-center p-0 pb-6">
                    <Skeleton className="h-7 w-48 mx-auto" />
                    <Skeleton className="h-4 w-36 mx-auto mt-2" />
                </CardHeader>
                <CardContent className="p-0 space-y-6">
                    <Skeleton className="h-28 w-full rounded-xl" />
                    <div className="space-y-4">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                    </div>
                    <div className="space-y-4">
                         <Skeleton className="h-24 w-full rounded-lg" />
                         <Skeleton className="h-24 w-full rounded-lg" />
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

export default function RouteDetailsPage() {
  return (
    <main className="min-h-screen w-full bg-[#06010F] p-4 flex items-center justify-center">
        <Suspense fallback={<RouteDetailsSkeleton />}>
            <RouteDetailsContent />
        </Suspense>
    </main>
  );
}
