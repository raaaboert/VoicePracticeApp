import { PageHeader } from "@/src/components/PageHeader";
import { ThemeSettingsPanel } from "@/src/components/ThemeSettingsPanel";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="The settings surface is in place now so appearance controls and future dashboard preferences have a stable home."
      />

      <ThemeSettingsPanel />
    </>
  );
}
