import { describe, expect, test } from "vitest";
import { cartDeliveryOptionsTransformRun } from "../src/cart_delivery_options_transform_run.js";

function input({ config = null, discountCodes = [], subtotal = 42, lines = [], deliveryOptions }) {
  return {
    deliveryCustomization: {
      metafield: config ? { jsonValue: config } : null,
    },
    cart: {
      discountCodes: { value: JSON.stringify(discountCodes) },
      shippingCampaign: null,
      hideEco: null,
      cost: {
        subtotalAmount: {
          amount: String(subtotal),
        },
      },
      lines,
      deliveryGroups: [
        {
          deliveryAddress: {
            countryCode: "PT",
          },
          deliveryOptions,
        },
      ],
    },
  };
}

function productLine({ quantity = 1, boxShipping = false, subsBoxMvp = false, bf22Exc = false, dynamicTags = [] } = {}) {
  return {
    quantity,
    merchandise: {
      product: {
        boxShipping,
        subsBoxMvp,
        bf22Exc,
        dynamicTags,
      },
    },
  };
}

describe("delivery customization rules", () => {
  test("missing config does not hide any delivery options", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping" },
          { handle: "subscription", title: "Subscription Delivery" },
        ],
      }),
    );

    expect(result).toEqual({
      operations: [],
    });
  });

  test("malformed config fails open", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        config: {
          version: 1,
          rules: [
            null,
            {
              id: "bad-actions",
              enabled: true,
              conditions: { discountCodeIncludes: ["VIP50"] },
              actions: null,
            },
            {
              id: "unknown-action",
              enabled: true,
              conditions: { discountCodeIncludes: ["VIP50"] },
              actions: [{ type: "unsupportedHideEverything" }],
            },
          ],
        },
        discountCodes: ["VIP50"],
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping" },
          { handle: "subscription", title: "Subscription Delivery" },
        ],
      }),
    );

    expect(result).toEqual({ operations: [] });
  });

  test("missing delivery groups fail open", () => {
    const result = cartDeliveryOptionsTransformRun({
      deliveryCustomization: {
        metafield: {
          jsonValue: {
            version: 1,
            rules: [
              {
                id: "hide-all",
                enabled: true,
                conditions: {},
                actions: [{ type: "hideAllDeliveryOptions" }],
              },
            ],
          },
        },
      },
      cart: {
        discountCodes: { value: "VIP50" },
        cost: { subtotalAmount: { amount: "42" } },
        lines: [],
      },
    });

    expect(result).toEqual({ operations: [] });
  });

  test("published subscription campaigns hide non-subscription delivery options", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        config: {
          version: 1,
          rules: [
            {
              id: "vip-goldjoy-subscription-only",
              enabled: true,
              conditions: { discountCodeIncludes: ["GOLDJOY"] },
              actions: [
                {
                  type: "hideDeliveryOptionsWhereTitleDoesNotInclude",
                  values: ["subscription"],
                },
              ],
            },
          ],
        },
        discountCodes: ["GOLDJOY"],
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping" },
          { handle: "subscription", title: "Subscription Delivery" },
        ],
      }),
    );

    expect(result).toEqual({
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "standard",
          },
        },
      ],
    });
  });

  test("published config can hide all rates below subtotal threshold", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        subtotal: 8,
        discountCodes: ["NOMORERUST"],
        config: {
          version: 1,
          rules: [
            {
              id: "nomorerust-minimum",
              enabled: true,
              conditions: {
                discountCodeIncludes: ["NOMORERUST"],
                subtotalLessThan: 10,
              },
              actions: [{ type: "hideAllDeliveryOptions" }],
            },
          ],
        },
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping" },
          { handle: "express", title: "Express Shipping" },
        ],
      }),
    );

    expect(result).toEqual({
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "standard",
          },
        },
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "express",
          },
        },
      ],
    });
  });

  test("normal carts hide subscription delivery options", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        config: {
          version: 1,
          rules: [
            {
              id: "normal-carts-hide-subscription",
              enabled: true,
              conditions: { noDiscountCode: true },
              actions: [
                {
                  type: "hideDeliveryOptionsWhereTitleIncludes",
                  values: ["subscription"],
                },
              ],
            },
          ],
        },
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping" },
          { handle: "subscription", title: "Ships with your next subscription renewal" },
        ],
      }),
    );

    expect(result).toEqual({
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "subscription",
          },
        },
      ],
    });
  });

  test("NOMORERUST hides all rates at zero subtotal", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        subtotal: 0,
        discountCodes: ["NOMORERUST"],
        config: {
          version: 1,
          rules: [
            {
              id: "nomorerust-hides-all",
              enabled: true,
              conditions: {
                discountCodeIncludes: ["NOMORERUST"],
                subtotal: {
                  comparison: "equal_to",
                  amount: 0,
                },
              },
              actions: [{ type: "hideAllDeliveryOptions" }],
            },
          ],
        },
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping" },
          { handle: "express", title: "Express Shipping" },
        ],
      }),
    );

    expect(result).toEqual({
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "standard",
          },
        },
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "express",
          },
        },
      ],
    });
  });

  test("UK rules hide letterbox for large carts and keep Standard UK visible", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        lines: [productLine({ quantity: 6 })],
        config: {
          version: 1,
          rules: [
            {
              id: "hide-letterbox-large-carts",
              enabled: true,
              conditions: {
                cartTotalQuantity: {
                  comparison: "greater_than",
                  amount: 5,
                },
              },
              actions: [
                {
                  type: "hideDeliveryOptionsWhereTitleIncludes",
                  values: ["Letterbox Delivery"],
                },
              ],
            },
            {
              id: "hide-standard-uk-small-carts",
              enabled: true,
              conditions: {
                lineProductTagQuantity: {
                  comparison: "equal_to",
                  amount: 0,
                  match: "match",
                  tags: ["box_shipping"],
                },
                cartTotalQuantity: {
                  comparison: "less_than_or_equal",
                  amount: 5,
                },
              },
              actions: [
                {
                  type: "hideDeliveryOptionsWhereTitleIncludes",
                  values: ["Standard UK"],
                },
              ],
            },
          ],
        },
        deliveryOptions: [
          { handle: "letterbox", title: "Letterbox Delivery" },
          { handle: "standard-uk", title: "Standard UK" },
          { handle: "express", title: "Express" },
        ],
      }),
    );

    expect(result).toEqual({
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "letterbox",
          },
        },
      ],
    });
  });

  test("uses product tags from dynamic function input variables", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        lines: [
          productLine({
            dynamicTags: [
              { tag: "ops_campaign_tag", hasTag: true },
              { tag: "ignored_tag", hasTag: false },
            ],
          }),
        ],
        config: {
          version: 1,
          productTags: ["ops_campaign_tag", "ignored_tag"],
          rules: [
            {
              id: "dynamic-tag-hides-eco",
              enabled: true,
              conditions: {
                lineProductTagQuantity: {
                  comparison: "greater_than_or_equal",
                  amount: 1,
                  match: "match",
                  tags: ["ops_campaign_tag"],
                },
              },
              actions: [
                {
                  type: "hideDeliveryOptionsWhereTitleIncludes",
                  values: ["eco"],
                },
              ],
            },
          ],
        },
        deliveryOptions: [
          { handle: "eco", title: "Eco Delivery" },
          { handle: "standard", title: "Standard Delivery" },
        ],
      }),
    );

    expect(result.operations).toEqual([
      {
        deliveryOptionHide: {
          deliveryOptionHandle: "eco",
        },
      },
    ]);
  });
});
