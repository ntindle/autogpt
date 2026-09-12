import { getListWorkspaceTasksMockHandler } from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import { server } from "@/mocks/mock-server";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@/tests/integrations/test-utils";
import { Profiler } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TasksPage from "../page";

const key = "autogpt.tasks.view.v1:scroll-user";
const initialView = {
  filter: "All",
  project: "",
  search: "",
  collapsed: [],
  selected: null,
  scroll: 0,
};

vi.mock("@/lib/auth/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "scroll-user" } }),
}));

beforeEach(() => {
  sessionStorage.clear();
  server.use(
    getListWorkspaceTasksMockHandler({
      tasks: Array.from({ length: 24 }, (_, index) => ({
        id: "scroll-task-" + index,
        user_id: "scroll-user",
        title: "Prepare sample kit " + index,
        version: 1,
        status: "todo" as const,
      })),
      assignees: [],
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function simulateNativeScroll(element: HTMLElement) {
  let offset = element.scrollTop;
  const writes = vi.fn();
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => offset,
    set(value: number) {
      writes(value);
      offset = value;
    },
  });
  return {
    writes,
    move(value: number) {
      offset = value;
      fireEvent.scroll(element);
    },
  };
}

test("native scrolling does not redraw the page or write the position back into the gesture", async () => {
  const commits = vi.fn();
  render(
    <Profiler id="tasks" onRender={commits}>
      <TasksPage />
    </Profiler>,
  );
  const list = await screen.findByLabelText("Task checklist");
  const gesture = simulateNativeScroll(list);
  const save = vi.spyOn(Storage.prototype, "setItem");
  commits.mockClear();
  for (const position of [180, 360, 540, 720]) gesture.move(position);
  expect(gesture.writes).not.toHaveBeenCalled();
  expect(commits).not.toHaveBeenCalled();
  expect(save.mock.calls.filter(([storedKey]) => storedKey === key)).toEqual(
    [],
  );
  await waitFor(() =>
    expect(JSON.parse(sessionStorage.getItem(key) ?? "null").scroll).toBe(720),
  );
});

test("scroll position survives navigation before the pending save and restores on return", async () => {
  sessionStorage.setItem(key, JSON.stringify({ ...initialView, scroll: 240 }));
  const first = render(<TasksPage />);
  const list = await screen.findByLabelText("Task checklist");
  expect(list.scrollTop).toBe(240);
  simulateNativeScroll(list).move(780);
  first.unmount();
  expect(JSON.parse(sessionStorage.getItem(key) ?? "null").scroll).toBe(780);
  render(<TasksPage />);
  expect((await screen.findByLabelText("Task checklist")).scrollTop).toBe(780);
});

test("leaving the browser saves the latest position without another scroll write", async () => {
  render(<TasksPage />);
  const list = await screen.findByLabelText("Task checklist");
  simulateNativeScroll(list).move(640);
  fireEvent(window, new Event("pagehide"));
  expect(JSON.parse(sessionStorage.getItem(key) ?? "null").scroll).toBe(640);
});
