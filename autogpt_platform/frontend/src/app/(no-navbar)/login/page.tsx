import { readLocalTeamPasswordConfig } from "@/lib/auth/server/team-password-config";
import { LoginPage } from "./LoginPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <LoginPage allowTeamPassword={readLocalTeamPasswordConfig().enabled} />
  );
}
