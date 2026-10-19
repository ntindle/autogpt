"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAuthStore } from "@/lib/auth/hooks/useAuthStore";
import type { OpenUIScope } from "./scope";

const OpenUIScopeContext = createContext<OpenUIScope>({});

interface Props extends OpenUIScope {
  children: ReactNode;
}

export function OpenUIScopeProvider({ children, ...scope }: Props) {
  return (
    <OpenUIScopeContext.Provider value={scope}>
      {children}
    </OpenUIScopeContext.Provider>
  );
}

export function useOpenUIScope() {
  const scope = useContext(OpenUIScopeContext);
  const ownerId = useAuthStore((state) => state.user?.id);
  return { ...scope, ownerId };
}
