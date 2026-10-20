import { readLocalTeamPasswordConfig } from "@/lib/auth/server/team-password-config";
import { SignupPage } from "./SignupPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <SignupPage allowTeamPassword={readLocalTeamPasswordConfig().enabled} />
  );
}
