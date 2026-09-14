import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message";

const ID = "d8ef4076-a348-49bc-9c6b-883a841f2fd4";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the shared chat renderer links named and bare workspace references", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(
    <MessageResponse mode="static">{`smart\\_car\\_platform\\_spec.md (v2) — workspace://${ID} — architecture.\n\nAlso workspace://${ID}.`}</MessageResponse>,
  );
  expect(
    screen.getByRole("button", { name: "smart_car_platform_spec.md" }),
  ).toBeTruthy();
  expect(screen.getByText(/\(v2\)/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Open file" }));
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      `/api/proxy/api/workspace/files/${ID}/download`,
      "_blank",
      "noreferrer",
    ),
  );
});

test("workspace links in shared chats retain the supplied public file route", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(
    <MessageResponse
      mode="static"
      workspaceFileUrlBuilder={(id) => `/share/token/files/${id}`}
    >{`workspace://${ID}`}</MessageResponse>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Open file" }));
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      `/share/token/files/${ID}`,
      "_blank",
      "noreferrer",
    ),
  );
});

test("workspace links are not invented in code, partial IDs, or external links", async () => {
  const { container } = render(
    <MessageResponse mode="static">{`\`workspace://${ID}\`\n\n\`\`\`text\nworkspace://${ID}\n\`\`\`\n\nworkspace://d8ef4076\n\nworkspace://${ID}/unexpected\n\n[External workspace://${ID}](https://example.com)`}</MessageResponse>,
  );
  await waitFor(() =>
    expect(container.querySelectorAll("code")).toHaveLength(2),
  );
  expect(screen.queryByRole("button", { name: "Open file" })).toBeNull();
  expect(
    screen.getByRole("button", { name: `External workspace://${ID}` }),
  ).toBeTruthy();
});

test("existing Markdown workspace links retain their label and resolve once", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(
    <MessageResponse mode="static">{`[Read the architecture](workspace://${ID}#text/markdown)`}</MessageResponse>,
  );
  expect(screen.getAllByRole("button")).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Read the architecture" }),
  );
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      `/api/proxy/api/workspace/files/${ID}/download`,
      "_blank",
      "noreferrer",
    ),
  );
});
