import { useId } from "react";
import { Input } from "@/components/atoms/Input/Input";
import { Button } from "@/components/atoms/Button/Button";
import { durationError, type ScheduleDraft } from "@/lib/openui/schedule";
import { useFieldValidation } from "../useFieldValidation";

interface Props {
  task: ScheduleDraft;
  disabled: boolean;
  first: boolean;
  last: boolean;
  times: string[];
  conflict: string;
  onMove: (direction: number) => void;
  onChange: (task: ScheduleDraft) => void;
  children?: React.ReactNode;
  highlighted?: boolean;
}

export function ScheduleTaskRow({
  task,
  disabled,
  first,
  last,
  times,
  conflict,
  onMove,
  onChange,
  children,
  highlighted,
}: Props) {
  const id = useId();
  const { error, ...handlers } = useFieldValidation(
    task.done ? "" : durationError(task.minutes),
    true,
  );
  return (
    <li
      className={`space-y-2 border-b border-border-base p-3 ${highlighted ? "rounded-lg bg-surface-hover/40" : ""}`}
    >
      {children}
      <label className="flex min-h-11 items-center gap-2 text-body font-medium text-foreground-base">
        <input
          type="checkbox"
          checked={task.done}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...task, done: event.target.checked })
          }
          aria-label={`Completed ${task.title}`}
          className="h-4 w-4 accent-primary"
        />
        {task.title}
      </label>
      {!task.done && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              {...handlers}
              id={id}
              label="Minutes"
              aria-label={`${task.title} minutes`}
              labelVariant="body"
              type="text"
              inputMode="numeric"
              maxLength={10}
              value={task.minutes}
              disabled={disabled || task.done}
              required={!task.done}
              onChange={(event) =>
                onChange({ ...task, minutes: event.target.value })
              }
              aria-invalid={!!error}
              aria-describedby={`${id}-error`}
              wrapperClassName="mb-0"
            />
          </div>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={disabled || first}
            aria-label={`Move ${task.title} earlier`}
            onClick={() => onMove(-1)}
          >
            Earlier
          </Button>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={disabled || last}
            aria-label={`Move ${task.title} later`}
            onClick={() => onMove(1)}
          >
            Later
          </Button>
        </div>
      )}
      <p
        id={`${id}-error`}
        aria-live="polite"
        className="text-caption text-error"
      >
        {error}
      </p>
      <div className="text-body text-foreground-tertiary">
        {task.done ? (
          <p>Completed · excluded from remaining work</p>
        ) : (
          <>
            {times.map((time) => (
              <p key={time}>{time}</p>
            ))}
            {conflict && <p className="text-error">{conflict}</p>}
            {task.earliest && (
              <p>
                Not before day {task.earliest.day + 1}, {task.earliest.time}
              </p>
            )}
            {task.deadline && (
              <p>
                Finish by day {task.deadline.day + 1}, {task.deadline.time}
              </p>
            )}
          </>
        )}
      </div>
    </li>
  );
}
