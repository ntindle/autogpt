import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageResponse } from "@/components/organisms/Message/Message";

const ID = "d8ef4076-a348-49bc-9c6b-883a841f2fd4";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the shared chat renderer links named and bare workspace references", async () => {
  render(
    <MessageResponse mode="static">{`smart\\_car\\_platform\\_spec.md (v2) — workspace://${ID} — architecture.\n\nAlso workspace://${ID}.`}</MessageResponse>,
  );
  expect(
    screen.getByRole("link", { name: "smart_car_platform_spec.md" }),
  ).toBeTruthy();
  expect(screen.getByText(/\(v2\)/)).toBeTruthy();
  const link = screen.getByRole("link", { name: "Open file" });
  expect(link.getAttribute("href")).toBe(
    `/api/proxy/api/workspace/files/${ID}/download`,
  );
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

test("workspace links in shared chats retain the supplied public file route", async () => {
  render(
    <MessageResponse
      mode="static"
      workspaceFileUrlBuilder={(id) => `/share/token/files/${id}`}
    >{`workspace://${ID}`}</MessageResponse>,
  );
  expect(
    screen.getByRole("link", { name: "Open file" }).getAttribute("href"),
  ).toBe(`/share/token/files/${ID}`);
});

test("workspace links are not invented in code, partial IDs, or external links", async () => {
  const { container } = render(
    <MessageResponse mode="static">{`\`workspace://${ID}\`\n\n\`\`\`text\nworkspace://${ID}\n\`\`\`\n\nworkspace://d8ef4076\n\nworkspace://${ID}/unexpected\n\n[External workspace://${ID}](https://example.com)`}</MessageResponse>,
  );
  await waitFor(() =>
    expect(container.querySelectorAll("code")).toHaveLength(2),
  );
  expect(screen.queryByRole("link", { name: "Open file" })).toBeNull();
  expect(
    screen.getByRole("button", { name: `External workspace://${ID}` }),
  ).toBeTruthy();
});

test("existing Markdown workspace links retain their label and resolve once", async () => {
  render(
    <MessageResponse mode="static">{`[Read the architecture](workspace://${ID}#text/markdown)`}</MessageResponse>,
  );
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(
    screen
      .getByRole("link", { name: "Read the architecture" })
      .getAttribute("href"),
  ).toBe(`/api/proxy/api/workspace/files/${ID}/download`);
});
