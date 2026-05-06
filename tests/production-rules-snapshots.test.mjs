import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  compileProductionRuleFile,
  productionRuleFiles,
} from "../scripts/production-rules-shared.mjs";

describe("production store DSL snapshots", () => {
  for (const ruleFile of productionRuleFiles()) {
    test(`${ruleFile.store} compiled config matches snapshot`, () => {
      const compiled = compileProductionRuleFile(ruleFile);
      const snapshot = readFileSync(ruleFile.snapshotPath, "utf8").trimEnd();

      assert.equal(compiled.json, snapshot);
    });
  }
});
