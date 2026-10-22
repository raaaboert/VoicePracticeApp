import { PageHeader } from "@/src/components/PageHeader";
import { ThemeSettingsPanel } from "@/src/components/ThemeSettingsPanel";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Choose your dashboard appearance or contact Peritio support."
      />

      <ThemeSettingsPanel />
    </>
  );
}
