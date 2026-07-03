"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { autocompleteAddress, type AutocompleteSuggestion, type LatLng } from "@/lib/mapping"

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  icon,
  rightSlot,
}: {
  value: string
  onChange: (val: string) => void
  onSelect: (suggestion: { address: string; location: LatLng }) => void
  placeholder?: string
  className?: string
  icon?: React.ReactNode
  rightSlot?: React.ReactNode
}) {
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value || value.trim().length < 3) {
      setSuggestions([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      const results = await autocompleteAddress(value)
      setSuggestions(results)
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative w-full">
      {icon}
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setShowSuggestions(true)
        }}
        onFocus={() => setShowSuggestions(true)}
        placeholder={placeholder}
        className={className}
      />
      {rightSlot}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-card shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onSelect(s)
                setShowSuggestions(false)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b border-border last:border-b-0"
            >
              {s.address}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
