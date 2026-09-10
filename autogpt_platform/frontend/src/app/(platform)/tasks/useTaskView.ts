import { useEffect, useRef, useState } from "react";
import { TASK_VIEWS, type TaskView } from "./helpers";

interface ViewState {
  filter: TaskView;
  project: string;
  search: string;
  collapsed: string[];
  selected: string | null;
  scroll: number;
}
const EMPTY_VIEW: ViewState = {
  filter: "All",
  project: "",
  search: "",
  collapsed: [],
  selected: null,
  scroll: 0,
};

export function useTaskView(userID: string) {
  const [state, setState] = useState<ViewState>(EMPTY_VIEW);
  const [loadedKey, setLoadedKey] = useState("");
  const key = `autogpt.tasks.view.v1:${userID}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let next = EMPTY_VIEW;
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (isViewState(value)) next = value;
    } catch {
      /* Storage is optional. */
    }
    setState(next);
    setLoadedKey(key);
    if (scrollRef.current) scrollRef.current.scrollTop = next.scroll;
  }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* Storage is optional. */
    }
  }, [key, loadedKey, state]);
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
  return { ...state, update, toggle, scrollRef };
}

function isViewState(value: unknown): value is ViewState {
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
    typeof value.scroll === "number"
  );
}
