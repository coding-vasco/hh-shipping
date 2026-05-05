import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_RULES_SCRIPT, compileRulesScript } from "../app/shipping-rules/compiler.server.js";

describe("shipping rules DSL compiler", () => {
  test("compiles the default campaign script", () => {
    const { config } = compileRulesScript(DEFAULT_RULES_SCRIPT);

    assert.equal(config.version, 1);
    assert.equal(config.rules.length, 4);
    assert.equal(config.rules[0].conditions.discountCodeIncludes[0], "VIP50");
    assert.equal(config.rules[0].actions[0].type, "hideDeliveryOptionsWhereTitleDoesNotInclude");
  });

  test("expands any-condition campaigns into separate rules", () => {
    const { config } = compileRulesScript(`
      settings({ productTags: ["box_shipping"] });
      campaigns([
        HideRates({
          name: "Normal carts hide subscription",
          condition: "any",
          qualifiers: [
            NoDiscountCodeQualifier(),
            CodeQualifier({ match: "does_not_include", codes: ["VIP50", "GOLDJOY"] }),
          ],
          rateSelector: RateNameSelector({ match: "include", names: ["subscription"] }),
        }),
      ]);
    `);

    assert.equal(config.rules.length, 2);
    assert.deepEqual(config.rules[0].conditions, { noDiscountCode: true });
    assert.deepEqual(config.rules[1].conditions, { discountCodeDoesNotInclude: ["VIP50", "GOLDJOY"] });
  });

  test("compiles a subtotal minimum campaign that hides all rates", () => {
    const { config } = compileRulesScript(`
      settings({ productTags: ["box_shipping"] });
      campaigns([
        HideRates({
          name: "NOMORERUST minimum paid item",
          condition: "all",
          qualifiers: [
            CodeQualifier({ match: "include", codes: ["NOMORERUST"] }),
            CartSubtotalQualifier({ comparison: "less_than", amount: 10 }),
          ],
          rateSelector: AllRatesSelector(),
        }),
      ]);
    `);

    assert.equal(config.rules.length, 1);
    assert.deepEqual(config.rules[0].conditions, {
      discountCodeIncludes: ["NOMORERUST"],
      subtotalLessThan: 10,
    });
    assert.equal(config.rules[0].actions[0].type, "hideAllDeliveryOptions");
  });

  test("rejects product tags that are not wired in the function input query", () => {
    assert.throws(
      () =>
        compileRulesScript(`
          settings({ productTags: ["new_ops_tag"] });
          campaigns([
            HideRates({
              name: "Unsupported tag",
              condition: "all",
              qualifiers: [
                CartHasItemQualifier({
                  comparison: "greater_than_or_equal",
                  amount: 1,
                  selector: ProductTagSelector({ match: "match", tags: ["new_ops_tag"] }),
                }),
              ],
              rateSelector: RateNameSelector({ match: "include", names: ["eco"] }),
            }),
          ]);
        `),
      /new_ops_tag/,
    );
  });
});
