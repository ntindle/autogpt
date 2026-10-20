const TEAM_EMAIL_DOMAIN = "agpt.co";

export function isTeamEmail(email: string) {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  return email.slice(at + 1).toLowerCase() === TEAM_EMAIL_DOMAIN;
}
