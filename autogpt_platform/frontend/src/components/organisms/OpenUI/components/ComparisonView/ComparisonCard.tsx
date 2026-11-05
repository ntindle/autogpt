import Image from "next/image";
import { useState } from "react";
import type { z } from "zod/v4";
import type { Comparison } from "@/lib/openui/catalog-results";
import { cn } from "@/lib/utils";
import { Button } from "@/components/atoms/Button/Button";

interface Props {
  option: z.infer<typeof Comparison.props>["options"][number];
  index: number;
  selected: boolean;
  preview: boolean;
  disabled: boolean;
  onChoose: () => void;
  buttonID: string;
}

export function ComparisonCard({
  option,
  index,
  selected,
  preview,
  disabled,
  onChoose,
  buttonID,
}: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-background p-3 transition-colors motion-reduce:transition-none md:p-4",
        (selected || preview) &&
          "border-primary bg-primary/5 ring-1 ring-primary",
      )}
    >
      <div className="text-xs flex flex-wrap items-center justify-between gap-1 font-medium text-muted-foreground">
        <span className="whitespace-nowrap">
          OPTION {index === 0 ? "A" : "B"}
        </span>
        {selected && <span className="text-primary">Selected</span>}
      </div>
      {option.image &&
        /^https?:\/\//.test(option.image.url) &&
        !imageFailed && (
          <Image
            src={option.image.url}
            alt={option.image.alt}
            width={480}
            height={240}
            unoptimized
            className="h-32 w-full rounded-lg object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
      <div>
        <h4 className="text-base font-semibold break-words text-foreground">
          {option.title}
        </h4>
        <p className="text-sm mt-1 hidden text-muted-foreground md:block">
          {option.description}
        </p>
      </div>
      <dl className="text-sm space-y-2">
        {option.facts?.map((fact, factIndex) => (
          <div key={factIndex} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{fact.label}</dt>
            <dd className="break-words text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <details className="text-sm text-muted-foreground md:hidden">
        <summary className="text-xs min-h-11 cursor-pointer py-3 font-medium text-foreground">
          About this option
        </summary>
        <p className="pb-2">{option.description}</p>
      </details>
      {option.source && /^https?:\/\//.test(option.source.url) && (
        <a
          className="text-xs text-primary underline underline-offset-2"
          href={option.source.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {option.source.label}
        </a>
      )}
      <Button
        id={buttonID}
        type="button"
        size="small"
        variant={selected ? "primary" : "secondary"}
        className="text-xs md:text-sm mt-auto h-auto min-h-11 w-full min-w-0 break-words whitespace-normal"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onChoose}
      >
        Choose {option.title}
      </Button>
    </article>
  );
}
