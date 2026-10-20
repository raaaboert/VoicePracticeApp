"use client";

import type { AppConfig, OrgDivisionRecord } from "@voicepractice/shared";
import { EnterpriseTrainingPacksCard } from "./EnterpriseTrainingPacksCard";
import { EnterpriseCustomScenariosCard } from "./EnterpriseCustomScenariosCard";
import { EnterpriseStandardScenarioDivisionCard } from "./EnterpriseStandardScenarioDivisionCard";

export function EnterpriseContentWorkspace({ orgId, orgName, config, users, divisions, divisionsEnabled }: {
  orgId: string; orgName?: string; config: AppConfig | null;
  users: { userId: string; email: string; status: string }[];
  divisions: OrgDivisionRecord[]; divisionsEnabled: boolean;
}) {
  return <div className="enterprise-tab-panel">
    <div className="card"><h3>Company Content &amp; Scenarios</h3>
      <p className="small">Company-wide catalogs, independent of the selected Focus Topic. In legacy mode, Topic-owned relationships remain available in Focus Topics → Content.</p>
    </div>
    <details className="topic-catalog-card" open><summary>Training Packs · company catalog</summary>
      <EnterpriseTrainingPacksCard orgId={orgId} orgName={orgName} config={config} orgUsers={users} />
    </details>
    <details className="topic-catalog-card" open><summary>Custom Scenarios &amp; Customer Practice Scenario Lifecycle</summary>
      <EnterpriseCustomScenariosCard orgId={orgId} orgName={orgName} config={config} />
    </details>
    <details className="topic-catalog-card"><summary>Advanced: Standard Scenario Division Routing</summary>
      <EnterpriseStandardScenarioDivisionCard orgId={orgId} divisions={divisions} divisionsEnabled={divisionsEnabled} />
    </details>
  </div>;
}
