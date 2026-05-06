import { describe, expect, test } from "vitest";
import { cartDeliveryOptionsDiscountsGenerateRun } from "../src/cart_delivery_options_discounts_generate_run.js";

function input({ config, discountCodes = [], lines = [], deliveryOptions }) {
  return {
    discount: {
      discountClasses: ["SHIPPING"],
      metafield: config ? { jsonValue: config } : null,
    },
    cart: {
      discountCodes: { value: JSON.stringify(discountCodes) },
      cost: {
        subtotalAmount: {
          amount: "42",
        },
      },
      lines,
      deliveryGroups: [
        {
          id: "gid://shopify/CartDeliveryGroup/1",
          deliveryAddress: {
            countryCode: "PT",
          },
          deliveryOptions,
        },
      ],
    },
  };
}

describe("shipping discount rules", () => {
  test("applies percentage discounts to matching delivery options", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      input({
        config: {
          version: 1,
          shippingDiscounts: [
            {
              id: "free-standard",
              enabled: true,
              conditions: {
                discountCodeIncludes: ["FREESHIP"],
              },
              rateSelector: {
                type: "deliveryOptionsWhereTitleIncludes",
                values: ["standard"],
              },
              discount: {
                type: "percentage",
                value: 100,
                message: "Free Shipping",
              },
            },
          ],
        },
        discountCodes: ["FREESHIP2026"],
      deliveryOptions: [
          { handle: "standard", title: "Standard Shipping EU" },
          { handle: "express", title: "Express Shipping" },
        ],
      }),
    );

    expect(result).toEqual({
      operations: [
        {
          deliveryDiscountsAdd: {
            candidates: [
              {
                message: "Free Shipping",
                targets: [
                  {
                    deliveryOption: {
                      handle: "standard",
                    },
                  },
                ],
                value: {
                  percentage: {
                    value: 100,
                  },
                },
              },
            ],
            selectionStrategy: "ALL",
          },
        },
      ],
    });
  });

  test("returns no operations without shipping discount class", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun({
      ...input({
        config: { version: 1, shippingDiscounts: [] },
        deliveryOptions: [{ handle: "standard", title: "Standard Shipping" }],
      }),
      discount: {
        discountClasses: ["PRODUCT"],
        metafield: null,
      },
    });

    expect(result).toEqual({ operations: [] });
  });
});
