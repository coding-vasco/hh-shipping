import {
  compileProductionRuleFile,
  displayPath,
  productionRuleFiles,
  summarizeConfig,
} from "./production-rules-shared.mjs";

let hasFailure = false;

for (const ruleFile of productionRuleFiles()) {
  try {
    const { config } = compileProductionRuleFile(ruleFile);
    const summary = summarizeConfig(config);

    console.log(`\n${ruleFile.store}`);
    console.log(`  file: ${displayPath(ruleFile.path)}`);
    console.log(`  hide rules: ${summary.hideRules}`);
    console.log(`  shipping discounts: ${summary.shippingDiscounts}`);
    console.log(`  validations: ${summary.validations}`);
    console.log(`  product tags: ${summary.productTags.length ? summary.productTags.join(", ") : "none"}`);

    if (summary.codeQualifierRules.length > 0) {
      console.log("  warnings:");
      console.log("    - CodeQualifier rules depend on Checkout UI Extension syncing _hh_discount_codes.");
      for (const description of summary.codeQualifierRules) {
        console.log(`      * ${description}`);
      }
    }
  } catch (error) {
    hasFailure = true;
    console.error(`\n${ruleFile.store}`);
    console.error(`  file: ${displayPath(ruleFile.path)}`);
    console.error(`  error: ${error.message}`);
  }
}

if (hasFailure) {
  process.exitCode = 1;
} else {
  console.log("\nProduction DSL validation passed.");
}
