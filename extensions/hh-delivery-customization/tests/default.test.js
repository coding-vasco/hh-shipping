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

function productLine({ quantity = 1, boxShipping = false, subsBoxMvp = false, bf22Exc = false } = {}) {
  return {
    quantity,
    merchandise: {
      product: {
        boxShipping,
        subsBoxMvp,
        bf22Exc,
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
});
