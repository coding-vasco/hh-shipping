import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { compileRulesScript, prettyJson } from "../app/shipping-rules/compiler.server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(__dirname, "..");
export const productionRulesDir = join(repoRoot, "docs", "production-store-rules");
export const productionSnapshotsDir = join(repoRoot, "tests", "snapshots", "production-rules");

export function productionRuleFiles() {
  return readdirSync(productionRulesDir)
    .filter((file) => file.endsWith(".dsl.js"))
    .sort()
    .map((file) => ({
      file,
      path: join(productionRulesDir, file),
      snapshotPath: join(productionSnapshotsDir, file.replace(/\.dsl\.js$/, ".json")),
      store: file.replace(/\.dsl\.js$/, ".myshopify.com"),
    }));
}

export function compileProductionRuleFile(ruleFile) {
  const source = readFileSync(ruleFile.path, "utf8");
  const compiled = compileRulesScript(source);
  return {
    ...ruleFile,
    config: compiled.config,
    json: prettyJson(compiled.config),
  };
}

export function summarizeConfig(config) {
  return {
    hideRules: config.rules?.length ?? 0,
    shippingDiscounts: config.shippingDiscounts?.length ?? 0,
    validations: config.validations?.length ?? 0,
    productTags: [...productTagsUsed(config)].sort(),
    codeQualifierRules: codeQualifierRuleDescriptions(config),
  };
}

export function productTagsUsed(config) {
  const tags = new Set();
  for (const rule of allRules(config)) {
    for (const tag of rule.conditions?.lineProductTagQuantity?.tags ?? []) {
      tags.add(tag);
    }
  }
  return tags;
}

export function codeQualifierRuleDescriptions(config) {
  return allRules(config)
    .filter((rule) => rule.conditions?.discountCodeIncludes || rule.conditions?.discountCodeDoesNotInclude)
    .map((rule) => rule.description || rule.id || "Unnamed rule");
}

function allRules(config) {
  return [
    ...(config.rules ?? []),
    ...(config.shippingDiscounts ?? []),
    ...(config.validations ?? []),
  ];
}

export function displayPath(path) {
  return basename(path);
}
