
"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, MapPin, Clock, Calendar, Loader2, Car, Bike, TramFront, Footprints } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getTripHistory, type Trip } from "@/lib/trip-storage"
import { formatDistance, formatDuration } from "@/lib/mapping"

const modeIcons: Record<string, any> = {
  DRIVING: Car,
  BICYCLING: Bike,
  TRANSIT: TramFront,
  WALKING: Footprints,
}

export default function TripHistoryPage() {
  const router = useRouter()
  const [trips, setTrips] = useState<Trip[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const history = await getTripHistory()
        setTrips(history)
      } catch (e) {
        console.error("Failed to load trip history:", e)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  return (
    <main className="min-h-screen w-full bg-background p-4">
      <div className="w-full max-w-md mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button onClick={() => router.push('/location')} variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Trip History</h1>
        </div>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {!isLoading && trips.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <MapPin className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p>No trips yet. Start tracking a route to see it here.</p>
          </div>
        )}

        <div className="space-y-3">
          {trips.map((trip) => {
            const Icon = modeIcons[trip.travelMode] || MapPin
            const startedDate = new Date(trip.startedAt)
            return (
              <Card key={trip.id} className="rounded-xl border-border">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 p-2 rounded-full bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{trip.destinationAddress}</p>
                      <p className="text-sm text-muted-foreground truncate">from {trip.startAddress}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {startedDate.toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {startedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        <span className="text-foreground font-medium">{formatDistance(trip.distanceMeters)}</span>
                        <span className="text-foreground font-medium">{formatDuration(trip.durationSeconds)}</span>
                        {trip.status === 'active' && (
                          <span className="text-amber-500 font-medium">In progress</span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </main>
  )
}
