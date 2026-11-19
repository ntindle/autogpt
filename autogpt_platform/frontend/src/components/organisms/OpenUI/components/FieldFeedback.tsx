import type { ReactNode } from "react";

interface Props {
  id: string;
  error: string;
  children: ReactNode;
}

export function FieldFeedback({ id, error, children }: Props) {
  return (
    <div>
      {children}
      <p id={id} aria-live="polite" className="text-xs text-red-600 -mt-5">
        {error}
      </p>
    </div>
  );
}
