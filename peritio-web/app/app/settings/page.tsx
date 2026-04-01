import { PageHeader } from "@/src/components/PageHeader";
import { ThemeSettingsPanel } from "@/src/components/ThemeSettingsPanel";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Manage appearance preferences today and keep future workspace settings in one place."
      />

      <ThemeSettingsPanel />
    </>
  );
}
