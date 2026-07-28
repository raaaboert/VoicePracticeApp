import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EnterpriseModuleEntitlementsCard } from "./EnterpriseModuleEntitlementsCard.js";

test("Training Content account module card renders server state as an accessible toggle", () => {
  const enabled = renderToStaticMarkup(
    <EnterpriseModuleEntitlementsCard
      trainingContent={{
        moduleKey: "training_content",
        enabled: true,
        updatedByActorId: "platform_admin",
        updatedAt: "2026-07-28T12:00:00.000Z",
      }}
      saving={false}
      onTrainingContentChange={() => {}}
    />
  );
  assert.match(enabled, />Training Content</);
  assert.match(enabled, /role="switch"/);
  assert.match(enabled, /aria-checked="true"/);
  assert.match(enabled, /checked=""/);
  assert.match(enabled, />Enabled</);

  const disabled = renderToStaticMarkup(
    <EnterpriseModuleEntitlementsCard
      trainingContent={{
        moduleKey: "training_content",
        enabled: false,
        updatedByActorId: null,
        updatedAt: null,
      }}
      saving={false}
      onTrainingContentChange={() => {}}
    />
  );
  assert.match(disabled, /aria-checked="false"/);
  assert.doesNotMatch(disabled, /checked=""/);
  assert.match(disabled, />Disabled</);
});

test("Training Content account module card disables interaction until server state is available", () => {
  const unavailable = renderToStaticMarkup(
    <EnterpriseModuleEntitlementsCard
      trainingContent={null}
      saving={false}
      onTrainingContentChange={() => {}}
    />
  );
  assert.match(unavailable, />Unavailable</);
  assert.match(unavailable, /disabled=""/);
});
