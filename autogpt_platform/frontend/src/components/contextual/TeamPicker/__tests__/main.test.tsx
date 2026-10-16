import { useOrgTeamStore } from "@/services/org-team/store";
import { render, screen } from "@/tests/integrations/test-utils";
import { afterEach, expect, test } from "vitest";
import { CreateSurface } from "../helpers";
import { TeamPicker } from "../TeamPicker";
import { useCreateTeamSelection } from "../useCreateTeamSelection";

function Harness() {
  const { teamId, setTeamId, teamRequestInit } = useCreateTeamSelection(
    CreateSurface.Copilot,
  );
  return (
    <>
      <TeamPicker
        surfaceKey={CreateSurface.Copilot}
        value={teamId}
        onChange={setTeamId}
      />
      <span data-testid="org">
        {new Headers(teamRequestInit.headers).get("X-Org-Id")}
      </span>
      <span data-testid="team">
        {new Headers(teamRequestInit.headers).get("X-Team-Id")}
      </span>
    </>
  );
}

function seed() {
  useOrgTeamStore.setState({
    activeOrgID: "org-a",
    activeTeamID: "old-team",
    isLoaded: true,
    teams: [
      {
        id: "default-team",
        name: "Default",
        slug: "default",
        orgId: "org-a",
        isDefault: true,
        joinPolicy: "OPEN",
      },
    ],
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FORCE_FLAG_SHOW_ORG_SETTINGS;
  window.localStorage.clear();
});

test("org-only creation ignores remembered human teams and pins the org", () => {
  process.env.NEXT_PUBLIC_FORCE_FLAG_SHOW_ORG_SETTINGS = "true";
  window.localStorage.setItem(
    "create-surface-teams",
    JSON.stringify({ "org-a:copilot": "old-team" }),
  );
  seed();
  render(<Harness />);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByTestId("org").textContent).toBe("org-a");
  expect(screen.getByTestId("team").textContent).toBe("");
});

test("the existing personal-only mode keeps its internal default team", () => {
  process.env.NEXT_PUBLIC_FORCE_FLAG_SHOW_ORG_SETTINGS = "false";
  seed();
  render(<Harness />);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByTestId("team").textContent).toBe("default-team");
});
