import { cn } from "@/lib/utils";
import type { IndexedLocation } from "./helpers";

interface Props {
  places: IndexedLocation[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function PlaceList({ places, selectedIndex, onSelect }: Props) {
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto" aria-label="Places">
      {places.map(({ index, place }) => (
        <button
          key={index}
          type="button"
          aria-pressed={selectedIndex === index}
          onClick={() => onSelect(index)}
          className={cn(
            "text-sm focus-visible:ring-purple-500 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2",
            selectedIndex === index
              ? "bg-purple-50 text-purple-800"
              : "text-zinc-700 hover:bg-zinc-50",
          )}
        >
          <span className="bg-purple-100 text-xs text-purple-700 flex size-6 shrink-0 items-center justify-center rounded-full font-semibold">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 break-words">{place.name}</span>
          <span className="text-xs text-zinc-500 max-w-[40%] break-words">
            {place.category}
          </span>
        </button>
      ))}
    </div>
  );
}
