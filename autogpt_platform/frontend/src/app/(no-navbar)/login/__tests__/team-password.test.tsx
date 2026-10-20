import type { ReactNode } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@/tests/integrations/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "../page";
import SignupPage from "../../signup/page";

const { login, signup, toast } = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/providers/onboarding/onboarding-provider", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/auth/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isUserLoading: false, isLoggedIn: false }),
}));
vi.mock("@/components/molecules/Toast/use-toast", () => ({
  useToast: () => ({ toast }),
}));
vi.mock("../actions", () => ({ login }));
vi.mock("../../signup/actions", () => ({ signup }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_BEHAVE_AS", "LOCAL");
  vi.stubEnv("AUTH_ALLOW_LOCAL_TEAM_PASSWORD_SIGNUP", "false");
  vi.stubEnv("AUTH_SIGNUP_ALLOWLIST", "toran@agpt.co");
  login.mockResolvedValue({ success: false, error: "invalid_credentials" });
  signup.mockResolvedValue({ success: false, error: "not_allowed" });
});

afterEach(() => vi.unstubAllEnvs());

describe.each([
  { name: "login", Page: LoginPage, submit: "Log in", action: login },
  { name: "signup", Page: SignupPage, submit: "Sign up", action: signup },
])("$name team password policy", ({ name, Page, submit, action }) => {
  function submitForm(email: string) {
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: email },
    });
    fireEvent.change(screen.getByLabelText("Password", { selector: "input" }), {
      target: { value: "local-preview-password" },
    });
    if (name === "signup") {
      fireEvent.change(
        screen.getByLabelText("Confirm Password", { selector: "input" }),
        {
          target: { value: "local-preview-password" },
        },
      );
    }
    fireEvent.click(screen.getByRole("button", { name: submit }));
  }

  it("keeps team password submission blocked by default", async () => {
    render(<Page />);
    submitForm("toran@agpt.co");

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("Google SSO"),
        }),
      ),
    );
    expect(action).not.toHaveBeenCalled();
  });

  it.each(["toran@agpt.co", "TORAN@AGPT.CO"])(
    "allows manually entered %s with the runtime LOCAL opt-in",
    async (email) => {
      vi.stubEnv("AUTH_ALLOW_LOCAL_TEAM_PASSWORD_SIGNUP", "true");
      render(<Page />);
      expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
        "",
      );
      submitForm(email);

      await waitFor(() => expect(action).toHaveBeenCalled());
      expect(action.mock.calls[0][0]).toBe(email);
      expect(screen.queryByRole("button", { name: /Google/ })).toBeNull();
      expect(toast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("Google SSO"),
        }),
      );
    },
  );

  it("keeps hosted team SSO even with the opt-in configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_BEHAVE_AS", "CLOUD");
    vi.stubEnv("AUTH_ALLOW_LOCAL_TEAM_PASSWORD_SIGNUP", "true");
    render(<Page />);
    submitForm("toran@agpt.co");

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("Google SSO"),
        }),
      ),
    );
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Google/ })).toBeDefined();
  });

  if (name === "login") {
    it("still permits existing accounts to log in after registration closes", async () => {
      vi.stubEnv("AUTH_ALLOW_LOCAL_TEAM_PASSWORD_SIGNUP", "true");
      vi.stubEnv("AUTH_ALLOW_NEW_ACCOUNTS", "false");
      render(<Page />);
      submitForm("toran@agpt.co");

      await waitFor(() => expect(action).toHaveBeenCalled());
    });
  }

  it.each(["", "@agpt.co", "*@agpt.co"])(
    "does not enable team passwords with only allowlist %s",
    async (allowlist) => {
      vi.stubEnv("AUTH_ALLOW_LOCAL_TEAM_PASSWORD_SIGNUP", "true");
      vi.stubEnv("AUTH_SIGNUP_ALLOWLIST", allowlist);
      render(<Page />);
      submitForm("toran@agpt.co");

      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(action).not.toHaveBeenCalled();
    },
  );

  it.each(["guest@example.com", "qa@previews.agpt.co"])(
    "preserves password submission for %s",
    async (email) => {
      render(<Page />);
      submitForm(email);

      await waitFor(() => expect(action).toHaveBeenCalled());
      expect(action.mock.calls[0][0]).toBe(email);
    },
  );
});
