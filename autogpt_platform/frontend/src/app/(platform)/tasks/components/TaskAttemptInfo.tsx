import { useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/atoms/Button/Button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipPortal,
} from "@/components/atoms/Tooltip/BaseTooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/molecules/Popover/Popover";

interface Props {
  title: string;
  onChat: () => void;
}

const explanation =
  "The last attempt ended without completing this task. Open chat to see what happened and what is needed to continue.";

export function TaskAttemptInfo({ title, onChat }: Props) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={hovered && !open} onOpenChange={setHovered}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Explain stopped attempt for ${title}`}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-amber-700 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:min-w-8"
            >
              <WarningCircle size={18} aria-hidden />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>
            <p className="font-semibold">Attempt stopped</p>
            <p>{explanation}</p>
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
      <PopoverContent aria-label="Attempt stopped" className="space-y-3">
        <p className="text-sm font-semibold">Attempt stopped</p>
        <p className="text-sm text-muted-foreground">{explanation}</p>
        <Button
          size="small"
          className="min-h-11"
          onClick={() => {
            setOpen(false);
            onChat();
          }}
        >
          Open chat
        </Button>
      </PopoverContent>
    </Popover>
  );
}
