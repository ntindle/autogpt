import { useEffect, useRef, useState } from "react";
import { TASK_VIEWS, type TaskView } from "./helpers";

interface ViewState {
  filter: TaskView;
  project: string;
  search: string;
  collapsed: string[];
  selected: string | null;
}

interface StoredViewState extends ViewState {
  scroll: number;
}

const EMPTY_VIEW: ViewState = {
  filter: "All",
  project: "",
  search: "",
  collapsed: [],
  selected: null,
};

export function useTaskView(userID: string) {
  const [state, setState] = useState<ViewState>(EMPTY_VIEW);
  const [loadedKey, setLoadedKey] = useState("");
  const key = `autogpt.tasks.view.v1:${userID}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);
  const pendingSave = useRef<ReturnType<typeof setTimeout>>();
  const persist = useRef(() => {});
  useEffect(() => {
    let next = EMPTY_VIEW;
    let position = 0;
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (isViewState(value)) {
        const { scroll, ...view } = value;
        next = view;
        position = Math.max(0, scroll);
      }
    } catch {
      /* Storage is optional. */
    }
    scrollPosition.current = position;
    setState(next);
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    function save() {
      clearTimeout(pendingSave.current);
      pendingSave.current = undefined;
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({ ...state, scroll: scrollPosition.current }),
        );
      } catch {
        /* Storage is optional. */
      }
    }
    function saveWhenHidden() {
      if (document.visibilityState === "hidden") save();
    }
    persist.current = save;
    save();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      save();
      persist.current = () => {};
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [key, loadedKey, state]);
  function rememberScroll(position: number) {
    scrollPosition.current = Math.max(0, position);
    clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => persist.current(), 200);
  }
  function update(patch: Partial<ViewState>) {
    setState((current) => ({ ...current, ...patch }));
  }
  function toggle(id: string) {
    setState((current) => ({
      ...current,
      collapsed: current.collapsed.includes(id)
        ? current.collapsed.filter((item) => item !== id)
        : [...current.collapsed, id],
    }));
  }
  return {
    ...state,
    update,
    toggle,
    scrollRef,
    scrollPosition,
    loadedKey,
    rememberScroll,
  };
}

function isViewState(value: unknown): value is StoredViewState {
  if (!value || typeof value !== "object") return false;
  return (
    "filter" in value &&
    TASK_VIEWS.some((filter) => filter === value.filter) &&
    "project" in value &&
    typeof value.project === "string" &&
    "search" in value &&
    typeof value.search === "string" &&
    "collapsed" in value &&
    Array.isArray(value.collapsed) &&
    value.collapsed.every((id) => typeof id === "string") &&
    "selected" in value &&
    (value.selected === null || typeof value.selected === "string") &&
    "scroll" in value &&
    typeof value.scroll === "number" &&
    Number.isFinite(value.scroll)
  );
}
