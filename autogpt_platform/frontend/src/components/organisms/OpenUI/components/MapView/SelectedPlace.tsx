import { Button } from "@/components/atoms/Button/Button";
import type { MapLocation } from "@/lib/openui/catalog-sections";
import { useOpenUIActionsDisabled } from "../../interactionContext";

interface Props {
  place: MapLocation;
  onDiscuss: () => void;
}

export function SelectedPlace({ place, onDiscuss }: Props) {
  const disabled = useOpenUIActionsDisabled();
  return (
    <div
      className="border-purple-100 bg-purple-50/50 space-y-3 rounded-lg border p-3"
      aria-label="Selected place"
    >
      <h4 className="text-sm text-zinc-900 font-semibold break-words">
        {place.name}
      </h4>
      <p className="text-sm text-zinc-600 leading-relaxed break-words">
        {place.detail}
      </p>
      <p className="text-xs text-zinc-500">
        {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}
      </p>
      <Button
        size="small"
        variant="secondary"
        disabled={disabled}
        onClick={onDiscuss}
      >
        Discuss this place
      </Button>
    </div>
  );
}
