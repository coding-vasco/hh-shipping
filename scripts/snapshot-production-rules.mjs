import { mkdirSync, writeFileSync } from "node:fs";

import {
  compileProductionRuleFile,
  productionRuleFiles,
  productionSnapshotsDir,
} from "./production-rules-shared.mjs";

mkdirSync(productionSnapshotsDir, { recursive: true });

for (const ruleFile of productionRuleFiles()) {
  const compiled = compileProductionRuleFile(ruleFile);
  writeFileSync(ruleFile.snapshotPath, `${compiled.json}\n`);
  console.log(`Updated ${ruleFile.snapshotPath}`);
}
