import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { DEFAULT_RULES_SCRIPT, compileRulesScript } from "../app/shipping-rules/compiler.server.js";

describe("shipping rules DSL compiler", () => {
  test("compiles the default campaign script", () => {
    const { config } = compileRulesScript(DEFAULT_RULES_SCRIPT);

    assert.equal(config.version, 1);
    assert.deepEqual(config.productTags, ["box_shipping", "subs_box_mvp", "bf22_exc"]);
    assert.deepEqual(config.rules, []);
    assert.deepEqual(config.shippingDiscounts, []);
    assert.deepEqual(config.validations, []);
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
      subtotal: {
        comparison: "less_than",
        amount: 10,
      },
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

  test("compiles a cart validation message title", () => {
    const { config } = compileRulesScript(`
      settings({ productTags: ["box_shipping"] });
      campaigns([
        CartValidation({
          name: "NOMORERUST requires paid jewelry",
          condition: "all",
          qualifiers: [
            CodeQualifier({ match: "include", codes: ["NOMORERUST"] }),
            CartSubtotalQualifier({ comparison: "equal_to", amount: 0 }),
          ],
          message_title: "Discount code requires a paid item",
          message: "NOMORERUST must be used with at least one paid jewelry item.",
          target: "$.cart",
        }),
      ]);
    `);

    assert.equal(config.validations.length, 1);
    assert.equal(config.validations[0].messageTitle, "Discount code requires a paid item");
    assert.equal(config.validations[0].message, "NOMORERUST must be used with at least one paid jewelry item.");
  });


  test("allows product tags declared in settings", () => {
    const { config } = compileRulesScript(`
      settings({ productTags: ["new_ops_tag"] });
      campaigns([
        HideRates({
          name: "Ops tag",
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
    `);

    assert.deepEqual(config.productTags, ["new_ops_tag"]);
    assert.deepEqual(config.rules[0].conditions.lineProductTagQuantity.tags, ["new_ops_tag"]);
  });

  test("rejects product tags that are not declared in settings", () => {
    assert.throws(
      () =>
        compileRulesScript(`
          settings({ productTags: ["box_shipping"] });
          campaigns([
            HideRates({
              name: "Undeclared tag",
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
      /settings\.productTags/,
    );
  });

  test("compiles the EU Script Editor campaign set", () => {
    const source = readFileSync(new URL("../docs/eu-shipping-rules-phase-1.dsl.js", import.meta.url), "utf8");
    const { config } = compileRulesScript(source);

    assert.equal(config.shippingDiscounts.length, 5);
    assert.equal(config.rules.length, 6);
    assert.equal(config.validations.length, 1);
    assert.equal(config.validations[0].messageTitle, "Discount code requires a paid item");
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
      subtotal: {
        comparison: "greater_than",
        amount: 16,
      },
    });
  });

  test("compiles the UK Script Editor campaign set", () => {
    const source = readFileSync(new URL("../docs/uk-shipping-rules-phase-1.dsl.js", import.meta.url), "utf8");
    const { config } = compileRulesScript(source);

    assert.equal(config.shippingDiscounts.length, 7);
    assert.equal(config.rules.length, 7);
    assert.equal(config.validations.length, 1);
    assert.deepEqual(config.rules[1].conditions.cartTotalQuantity, {
      comparison: "greater_than",
      amount: 5,
    });
    assert.deepEqual(config.shippingDiscounts[5].conditions.cartTotalQuantity, {
      comparison: "greater_than_or_equal",
      amount: 4,
    });
  });

  test("compiles the US Script Editor campaign set", () => {
    const source = readFileSync(new URL("../docs/us-shipping-rules-phase-1.dsl.js", import.meta.url), "utf8");
    const { config } = compileRulesScript(source);

    assert.equal(config.shippingDiscounts.length, 5);
    assert.equal(config.rules.length, 4);
    assert.equal(config.validations.length, 1);
    assert.deepEqual(config.validations[0].conditions.subtotal, {
      comparison: "equal_to",
      amount: 0,
    });
  });
});
