import { redirect } from "next/navigation";

export default function TrainingPage() {
  redirect("/app/dashboard?tab=training");
}
