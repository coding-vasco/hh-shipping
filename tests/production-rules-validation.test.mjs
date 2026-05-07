import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  compileProductionRuleFile,
  duplicateIdFindings,
  productionRuleFiles,
  productionRuleFindings,
} from "../scripts/production-rules-shared.mjs";

describe("production DSL validation", () => {
  test("production store DSL files have no validation failures", () => {
    for (const ruleFile of productionRuleFiles()) {
      const compiled = compileProductionRuleFile(ruleFile);
      const failures = productionRuleFindings(compiled).filter((finding) => finding.level === "failure");

      assert.deepEqual(failures, [], `${ruleFile.store} should not have validation failures`);
    }
  });

  test("production store DSL files warn about checkout-sensitive rule types", () => {
    for (const ruleFile of productionRuleFiles()) {
      const compiled = compileProductionRuleFile(ruleFile);
      const warnings = productionRuleFindings(compiled).filter((finding) => finding.level === "warning");
      const warningMessages = warnings.map((finding) => finding.message);

      assert.ok(
        warningMessages.includes("CodeQualifier rules depend on Checkout UI Extension syncing _hh_discount_codes."),
        `${ruleFile.store} should warn when discount-code rules exist`,
      );
      assert.ok(
        warningMessages.includes(
          "ShippingDiscount campaigns require the app automatic shipping discount to be active and compatible with discount-code combination settings.",
        ),
        `${ruleFile.store} should warn when shipping discounts exist`,
      );
      assert.ok(
        warningMessages.includes("CartValidation campaigns can block checkout."),
        `${ruleFile.store} should warn when checkout validations exist`,
      );
    }
  });

  test("duplicate compiled ids are validation failures", () => {
    const findings = duplicateIdFindings({
      version: 1,
      rules: [
        { id: "same-id", description: "First", conditions: {}, actions: [] },
        { id: "same-id", description: "Second", conditions: {}, actions: [] },
      ],
      shippingDiscounts: [],
      validations: [],
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0].level, "failure");
    assert.match(findings[0].message, /Duplicate compiled rule id "same-id"/);
  });
});
