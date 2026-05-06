import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { DEFAULT_RULES_SCRIPT, compileRulesScript } from "../app/shipping-rules/compiler.server.js";

describe("shipping rules DSL compiler", () => {
  test("compiles the default campaign script", () => {
    const { config } = compileRulesScript(DEFAULT_RULES_SCRIPT);

    assert.equal(config.version, 1);
    assert.equal(config.rules.length, 4);
    assert.equal(config.shippingDiscounts.length, 1);
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

  test("compiles a shipping discount campaign", () => {
    const { config } = compileRulesScript(`
      settings({ productTags: ["subs_box_mvp"] });
      campaigns([
        ShippingDiscount({
          name: "Subscription free standard shipping",
          condition: "all",
          qualifiers: [
            CartHasItemQualifier({
              comparison: "greater_than_or_equal",
              amount: 1,
              selector: ProductTagSelector({ match: "match", tags: ["subs_box_mvp"] }),
            }),
          ],
          rateSelector: RateNameSelector({ match: "include", names: ["standard"] }),
          discount: PercentageDiscount({ percent: 100, message: "Free Shipping" }),
        }),
      ]);
    `);

    assert.equal(config.rules.length, 0);
    assert.equal(config.shippingDiscounts.length, 1);
    assert.deepEqual(config.shippingDiscounts[0].rateSelector, {
      type: "deliveryOptionsWhereTitleIncludes",
      values: ["standard"],
    });
    assert.deepEqual(config.shippingDiscounts[0].discount, {
      type: "percentage",
      value: 100,
      message: "Free Shipping",
    });
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

  test("compiles the EU Script Editor campaign set", () => {
    const source = readFileSync(new URL("../docs/eu-shipping-rules-phase-1.dsl.js", import.meta.url), "utf8");
    const { config } = compileRulesScript(source);

    assert.equal(config.shippingDiscounts.length, 5);
    assert.equal(config.rules.length, 5);
    assert.equal(config.shippingDiscounts[1].description, "Free priority by code or quantity");
    assert.deepEqual(config.shippingDiscounts[1].conditions.discountCodeIncludes, [
      "DEAR",
      "HHXGYMSHARK",
      "HHXPVOLVE",
      "ANNASTRUP",
      "MADIE",
      "RDY2MINGLE",
      "HEYSJANA",
      "HEYAMALIE",
      "HEYEVAMELOCHE",
      "KNOWMEBETTER",
      "SPINWIN_FS",
    ]);
    assert.deepEqual(config.shippingDiscounts[2].conditions.lineProductTagQuantity, {
      comparison: "greater_than_or_equal",
      amount: 5,
      match: "does_not_match",
      tags: ["bf22_exc"],
    });
    assert.deepEqual(config.shippingDiscounts[4].conditions, {
      lineProductTagQuantity: {
        comparison: "greater_than_or_equal",
        amount: 1,
        match: "match",
        tags: ["box_shipping"],
      },
      subtotalGreaterThan: 16,
    });
  });
});
