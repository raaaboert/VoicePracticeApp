import { redirect } from "next/navigation";

export default function UsersPage() {
  redirect("/app/dashboard?tab=users");
}
