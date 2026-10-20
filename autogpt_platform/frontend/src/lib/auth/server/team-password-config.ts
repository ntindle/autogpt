import { readSignupGateConfig } from "../signup-gate";
import { isTeamEmail } from "../team-email";

export function readLocalTeamPasswordConfig() {
  const allowlist = readSignupGateConfig().allowlist.filter(
    (email) =>
      !email.startsWith("@") && !email.includes("*") && isTeamEmail(email),
  );

  return {
    enabled:
      process.env.NEXT_PUBLIC_BEHAVE_AS === "LOCAL" &&
      process.env.AUTH_ALLOW_LOCAL_TEAM_PASSWORD_SIGNUP === "true" &&
      allowlist.length > 0,
    allowlist,
  };
}
