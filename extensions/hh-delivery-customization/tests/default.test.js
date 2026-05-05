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

describe("delivery customization rules", () => {
  test("fallback normal carts hide subscription delivery options", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
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
            deliveryOptionHandle: "subscription",
          },
        },
      ],
    });
  });

  test("fallback subscription campaigns hide non-subscription delivery options", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
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
});
