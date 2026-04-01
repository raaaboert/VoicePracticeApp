import assert from "node:assert/strict";
import test from "node:test";

import { createPostCommitEffectRegistry, runPostCommitEffects } from "./postCommitEffects.js";

test("post-commit effect registry queues, drains, and discards effects by context", () => {
  const registry = createPostCommitEffectRegistry<object>();
  const contextA = {};
  const contextB = {};
  const seen: string[] = [];

  registry.queue(contextA, {
    category: "security_cleanup",
    description: "first",
    run: async () => {
      seen.push("first");
    }
  });
  registry.queue(contextA, {
    category: "post_commit_cleanup",
    description: "second",
    run: async () => {
      seen.push("second");
    }
  });
  registry.queue(contextB, {
    category: "post_commit_cleanup",
    description: "other",
    run: async () => {
      seen.push("other");
    }
  });

  const drainedA = registry.drain(contextA);
  assert.equal(drainedA.length, 2);
  assert.deepEqual(
    drainedA.map((effect) => effect.description),
    ["first", "second"]
  );
  assert.deepEqual(registry.drain(contextA), []);

  registry.discard(contextB);
  assert.deepEqual(registry.drain(contextB), []);
  assert.deepEqual(seen, []);
});

test("post-commit effects continue after failure and surface failure metadata", async () => {
  const failures: Array<{ category: string; description: string; message: string }> = [];
  const seen: string[] = [];

  await runPostCommitEffects(
    [
      {
        category: "security_cleanup",
        description: "revoke sessions",
        run: async () => {
          seen.push("first");
          throw new Error("boom");
        }
      },
      {
        category: "post_commit_cleanup",
        description: "delete support cases",
        run: async () => {
          seen.push("second");
        }
      }
    ],
    {
      onFailure: (effect, error) => {
        failures.push({
          category: effect.category,
          description: effect.description,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  );

  assert.deepEqual(seen, ["first", "second"]);
  assert.deepEqual(failures, [
    {
      category: "security_cleanup",
      description: "revoke sessions",
      message: "boom"
    }
  ]);
});
