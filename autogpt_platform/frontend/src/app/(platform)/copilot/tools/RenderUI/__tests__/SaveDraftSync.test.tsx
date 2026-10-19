import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/mock-server";
import { showResult } from "./renderConnected";
import { formView } from "@/lib/openui/__tests__/capability-fixtures";

const source = formView(
  'Field("notes", "Notes", "Original", "", false)',
).replace("[form])", '[form], "sync-view")');
const path = "*/api/chat/sessions/connected-session/ui-drafts/sync-view";

async function saveToFiles() {
  fireEvent.click(screen.getByRole("button", { name: "Save to files" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  return dialog;
}

describe("save-to-files draft synchronization", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("waits for an in-flight draft and saves the newest edits before creating the file", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let revision = 0;
    let state: unknown = {};
    let started = false;
    const events: string[] = [];
    server.use(
      http.get(path, () =>
        HttpResponse.json({
          source,
          revision,
          state,
          writable: true,
          tool_call_id: "connected-ui",
        }),
      ),
      http.put(path, async ({ request }) => {
        const body = (await request.json()) as { state: unknown };
        started = true;
        await held;
        state = body.state;
        revision += 1;
        events.push(`write:${JSON.stringify(state)}`);
        return HttpResponse.json({
          source,
          revision,
          state,
          writable: true,
          tool_call_id: "connected-ui",
        });
      }),
      http.post(`${path}/save`, () => {
        events.push(`save:${JSON.stringify(state)}`);
        return HttpResponse.json(
          { detail: "Keep the dialog open for inspection" },
          { status: 503 },
        );
      }),
    );
    await showResult(vi.fn(), false, source);
    fireEvent.change(await screen.findByLabelText("Notes"), {
      target: { value: "First edit" },
    });
    await waitFor(() => expect(started).toBe(true), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Newest edit" },
    });
    const dialog = await saveToFiles();
    expect(
      within(dialog)
        .getByRole("button", { name: "Save" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.keyDown(within(dialog).getByLabelText("File name"), {
      key: "Enter",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events).toEqual([]);
    release();
    await waitFor(() => expect(events).toHaveLength(3));
    expect(events[0]).toContain("First edit");
    expect(events[1]).toContain("Newest edit");
    expect(events[2]).toContain("save:");
    expect(events[2]).toContain("Newest edit");
  }, 15000);

  it("keeps the editable draft when synchronization fails", async () => {
    const save = vi.fn();
    server.use(
      http.get(path, () =>
        HttpResponse.json({
          source,
          revision: 0,
          state: {},
          writable: true,
          tool_call_id: "connected-ui",
        }),
      ),
      http.put(path, () =>
        HttpResponse.json({ detail: "Offline" }, { status: 503 }),
      ),
      http.post(`${path}/save`, () => {
        save();
        return HttpResponse.json({});
      }),
    );
    await showResult(vi.fn(), false, source);
    fireEvent.change(await screen.findByLabelText("Notes"), {
      target: { value: "Unsynced input" },
    });
    const dialog = await saveToFiles();
    await within(dialog).findByText("The view couldn't be saved. Try again.");
    expect(save).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Notes") as HTMLInputElement).value).toBe(
      "Unsynced input",
    );
  });
});
