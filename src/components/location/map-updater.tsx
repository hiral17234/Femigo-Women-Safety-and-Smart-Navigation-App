"use client"
import { useEffect } from "react"
import { useMap } from "react-leaflet"

export function MapUpdater({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, zoom, { animate: true })
  }, [center[0], center[1], zoom]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
