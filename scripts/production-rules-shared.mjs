import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { compileRulesScript, prettyJson } from "../app/shipping-rules/compiler.server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(__dirname, "..");
export const productionRulesDir = join(repoRoot, "docs", "production-store-rules");
export const productionSnapshotsDir = join(repoRoot, "tests", "snapshots", "production-rules");
export const requiredProductionStores = [
  "hey-harper-shop-nl.myshopify.com",
  "hey-harper-shop-uk.myshopify.com",
  "hey-harper-shop-us.myshopify.com",
];

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

export function missingProductionRuleFiles(ruleFiles = productionRuleFiles()) {
  const stores = new Set(ruleFiles.map((ruleFile) => ruleFile.store));
  return requiredProductionStores.filter((store) => !stores.has(store));
}

export function summarizeConfig(config) {
  return {
    hideRules: config.rules?.length ?? 0,
    shippingDiscounts: config.shippingDiscounts?.length ?? 0,
    validations: config.validations?.length ?? 0,
    productTags: [...productTagsUsed(config)].sort(),
    codeQualifierRules: codeQualifierRuleDescriptions(config),
    hideAllRatesRules: hideAllRatesRuleDescriptions(config),
    shippingDiscountRules: shippingDiscountRuleDescriptions(config),
    validationRules: validationRuleDescriptions(config),
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

export function hideAllRatesRuleDescriptions(config) {
  return (config.rules ?? [])
    .filter((rule) => (rule.actions ?? []).some((action) => action.type === "hideAllDeliveryOptions"))
    .map((rule) => rule.description || rule.id || "Unnamed hide-rates rule");
}

export function shippingDiscountRuleDescriptions(config) {
  return (config.shippingDiscounts ?? []).map((rule) => rule.description || rule.id || "Unnamed shipping discount");
}

export function validationRuleDescriptions(config) {
  return (config.validations ?? []).map((rule) => rule.description || rule.id || "Unnamed checkout validation");
}

export function snapshotFinding(compiled) {
  if (!existsSync(compiled.snapshotPath)) {
    return {
      level: "failure",
      message: `Snapshot is missing: ${displayPath(compiled.snapshotPath)}. Run npm run snapshot:production if this change is intentional.`,
    };
  }

  const snapshot = readFileSync(compiled.snapshotPath, "utf8").trimEnd();
  if (compiled.json !== snapshot) {
    return {
      level: "failure",
      message: `Compiled JSON does not match ${displayPath(compiled.snapshotPath)}. Run npm run snapshot:production if this change is intentional.`,
    };
  }

  return null;
}

export function duplicateIdFindings(config) {
  const ids = new Map();
  const findings = [];

  for (const rule of allRules(config)) {
    if (!rule.id) continue;
    const previous = ids.get(rule.id);
    if (previous) {
      findings.push({
        level: "failure",
        message: `Duplicate compiled rule id "${rule.id}" used by "${previous}" and "${rule.description || "Unnamed rule"}".`,
      });
      continue;
    }
    ids.set(rule.id, rule.description || "Unnamed rule");
  }

  return findings;
}

export function productionRuleFindings(compiled, options = {}) {
  const findings = [];
  const summary = summarizeConfig(compiled.config);

  if (options.checkSnapshots !== false) {
    const finding = snapshotFinding(compiled);
    if (finding) findings.push(finding);
  }

  findings.push(...duplicateIdFindings(compiled.config));

  if (summary.hideRules + summary.shippingDiscounts + summary.validations === 0) {
    findings.push({
      level: "warning",
      message: "This store DSL compiles to zero campaigns. Checkout will fail open.",
    });
  }

  if (summary.codeQualifierRules.length > 0) {
    findings.push({
      level: "warning",
      message: "CodeQualifier rules depend on Checkout UI Extension syncing _hh_discount_codes.",
      details: summary.codeQualifierRules,
    });
  }

  if (summary.hideAllRatesRules.length > 0) {
    findings.push({
      level: "warning",
      message: "Some campaigns can hide all shipping rates.",
      details: summary.hideAllRatesRules,
    });
  }

  if (summary.shippingDiscountRules.length > 0) {
    findings.push({
      level: "warning",
      message: "ShippingDiscount campaigns require the app automatic shipping discount to be active and compatible with discount-code combination settings.",
      details: summary.shippingDiscountRules,
    });
  }

  if (summary.validationRules.length > 0) {
    findings.push({
      level: "warning",
      message: "CartValidation campaigns can block checkout.",
      details: summary.validationRules,
    });
  }

  return findings;
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
