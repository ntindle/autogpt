"use client";

import "ol/ol.css";
import type { IndexedLocation } from "./helpers";
import { useMapCanvas } from "./useMapCanvas";

interface Props {
  locations: IndexedLocation[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  title: string;
}

export function MapCanvas({
  locations,
  selectedIndex,
  onSelect,
  title,
}: Props) {
  const { containerRef, error } = useMapCanvas(
    locations,
    selectedIndex,
    onSelect,
  );
  return (
    <div className="relative isolate">
      <div
        ref={containerRef}
        className="bg-zinc-100 h-72 w-full sm:h-80"
        aria-label={`${title} map`}
        tabIndex={0}
      />
      {error && (
        <p
          role="status"
          className="border-amber-200 bg-amber-50 text-xs text-amber-800 border-y p-3"
        >
          Map tiles could not load. You can still select and discuss places from
          the list below.
        </p>
      )}
    </div>
  );
}
