import { useId } from "react";
import { Button } from "@/components/atoms/Button/Button";
import { Input } from "@/components/atoms/Input/Input";

interface Props {
  title: string;
  description: string;
  filter: string;
  onFilter: (value: string) => void;
  onShowAll: () => void;
}

export function MapControls({
  title,
  description,
  filter,
  onFilter,
  onShowAll,
}: Props) {
  const id = useId();
  return (
    <div className="space-y-3 p-4">
      <h3 className="text-sm text-zinc-800 font-semibold">{title}</h3>
      <p className="text-xs text-zinc-500 leading-relaxed">{description}</p>
      <div className="flex flex-wrap items-start gap-2">
        <Input
          id={id}
          label={`Filter ${title}`}
          hideLabel
          placeholder="Find a place or category…"
          value={filter}
          onChange={(event) => onFilter(event.target.value)}
          wrapperClassName="min-w-0 flex-1"
          size="small"
        />
        <Button variant="secondary" size="small" onClick={onShowAll}>
          Show all
        </Button>
      </div>
    </div>
  );
}
