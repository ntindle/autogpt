import { useOrgTeamStore } from "@/services/org-team/store";
import { server } from "@/mocks/mock-server";
import { render, screen, waitFor } from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGetV2GetOrganizationDetailsMockHandler,
  getGetV2ListOrganizationMembersMockHandler,
  getGetV2ListOrganizationMembersMockHandler401,
  getPatchV2UpdateOrganizationMockHandler,
} from "@/app/api/__generated__/endpoints/orgs/orgs.msw";
import OrganizationSettingsPage from "../page";
const OWNER_USER_ID = "user-owner";

vi.mock("@/lib/auth/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: OWNER_USER_ID },
    isLoggedIn: true,
    isUserLoading: false,
  }),
}));

const TEAM_ORG = {
  id: "org-company",
  name: "Acme Inc",
  slug: "acme",
  avatar_url: null,
  description: "We make everything",
  is_personal: false,
  member_count: 2,
  created_at: new Date("2026-01-01T00:00:00Z"),
};

const OWNER_MEMBER = {
  id: "m-1",
  user_id: OWNER_USER_ID,
  email: "jane@acme.test",
  name: "Jane",
  is_owner: true,
  is_admin: true,
  is_billing_manager: false,
  joined_at: new Date("2026-01-01T00:00:00Z"),
};

function seedActiveOrg(orgID: string) {
  useOrgTeamStore.setState({
    activeOrgID: orgID,
    activeTeamID: null,
    orgs: [
      {
        id: TEAM_ORG.id,
        name: TEAM_ORG.name,
        slug: TEAM_ORG.slug,
        avatarUrl: null,
        isPersonal: false,
        memberCount: 2,
      },
    ],
    teams: [],
    isLoaded: true,
  });
}

function mockTeamOrg() {
  server.use(
    getGetV2GetOrganizationDetailsMockHandler(TEAM_ORG),
    getGetV2ListOrganizationMembersMockHandler([OWNER_MEMBER]),
  );
}
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FORCE_FLAG_SHOW_ORG_SETTINGS;
});
describe("OrganizationSettingsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    process.env.NEXT_PUBLIC_FORCE_FLAG_SHOW_ORG_SETTINGS = "true";
    seedActiveOrg(TEAM_ORG.id);
    mockTeamOrg();
  });

  it("returns not found for a direct link when org settings are disabled", () => {
    let requests = 0;
    process.env.NEXT_PUBLIC_FORCE_FLAG_SHOW_ORG_SETTINGS = "false";
    server.use(
      getGetV2GetOrganizationDetailsMockHandler(() => {
        requests += 1;
        return TEAM_ORG;
      }),
      getGetV2ListOrganizationMembersMockHandler(() => {
        requests += 1;
        return [OWNER_MEMBER];
      }),
    );

    expect(() => render(<OrganizationSettingsPage />)).toThrow();
    expect(requests).toBe(0);
  });
  it("shows an error when the members query fails", async () => {
    server.use(
      getGetV2GetOrganizationDetailsMockHandler(TEAM_ORG),
      getGetV2ListOrganizationMembersMockHandler401(),
    );
    render(<OrganizationSettingsPage />);

    expect(
      await screen.findByText(/Failed to load organization/i),
    ).toBeDefined();
    expect(screen.queryByTestId("org-members-section")).toBeNull();
  });
  it("updates the org profile", async () => {
    const patchSpy = vi.fn();
    mockTeamOrg();
    server.use(
      getPatchV2UpdateOrganizationMockHandler(() => {
        patchSpy();
        return { ...TEAM_ORG, name: "Acme Corp" };
      }),
    );
    render(<OrganizationSettingsPage />);

    const nameInput = await screen.findByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Acme Corp");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("shows private organization settings without human team controls", async () => {
    render(<OrganizationSettingsPage />);
    await screen.findByTestId("org-profile-section");
    for (const label of [
      "Members",
      "Invitations",
      "Teams",
      "Billing",
      "Transfer ownership",
    ])
      expect(screen.queryByText(label)).toBeNull();
  });
});
