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

  test("malformed config fails open", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      input({
        config: {
          version: 1,
          shippingDiscounts: [
            null,
            {
              id: "bad-selector",
              enabled: true,
              conditions: { discountCodeIncludes: ["FREESHIP"] },
              rateSelector: { type: "unsupportedSelector" },
              discount: {
                type: "percentage",
                value: 100,
                message: "Free Shipping",
              },
            },
          ],
        },
        discountCodes: ["FREESHIP"],
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping" },
        ],
      }),
    );

    expect(result).toEqual({ operations: [] });
  });

  test("missing delivery groups fail open", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun({
      discount: {
        discountClasses: ["SHIPPING"],
        metafield: {
          jsonValue: {
            version: 1,
            shippingDiscounts: [
              {
                id: "free-everything",
                enabled: true,
                conditions: {},
                rateSelector: { type: "allDeliveryOptions" },
                discount: {
                  type: "percentage",
                  value: 100,
                  message: "Free Shipping",
                },
              },
            ],
          },
        },
      },
      cart: {
        discountCodes: { value: "FREESHIP" },
        cost: { subtotalAmount: { amount: "42" } },
        lines: [],
      },
    });

    expect(result).toEqual({ operations: [] });
  });

  test("applies subscription free standard shipping by product tag", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      input({
        config: {
          version: 1,
          shippingDiscounts: [
            {
              id: "subscription-free-standard",
              enabled: true,
              conditions: {
                lineProductTagQuantity: {
                  comparison: "greater_than_or_equal",
                  amount: 1,
                  match: "match",
                  tags: ["subs_box_mvp"],
                },
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
        lines: [productLine({ subsBoxMvp: true })],
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping EU" },
          { handle: "priority", title: "Priority Handling EU" },
        ],
      }),
    );

    expect(result.operations[0].deliveryDiscountsAdd.candidates[0].targets).toEqual([
      {
        deliveryOption: {
          handle: "standard",
        },
      },
    ]);
  });

  test("applies priority discount for qualifying non-excluded quantity", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      input({
        config: {
          version: 1,
          shippingDiscounts: [
            {
              id: "free-priority-by-quantity",
              enabled: true,
              conditions: {
                lineProductTagQuantity: {
                  comparison: "greater_than_or_equal",
                  amount: 5,
                  match: "does_not_match",
                  tags: ["bf22_exc"],
                },
              },
              rateSelector: {
                type: "deliveryOptionsWhereTitleIncludes",
                values: ["Priority", "Prioritaire"],
              },
              discount: {
                type: "percentage",
                value: 100,
                message: "Free Priority Shipping",
              },
            },
          ],
        },
        lines: [productLine({ quantity: 5, bf22Exc: false })],
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping" },
          { handle: "priority", title: "Priority Handling" },
        ],
      }),
    );

    expect(result.operations[0].deliveryDiscountsAdd.candidates[0]).toMatchObject({
      message: "Free Priority Shipping",
      targets: [
        {
          deliveryOption: {
            handle: "priority",
          },
        },
      ],
    });
  });

  test("applies UK BFDEAL4 express discount only with 4+ items", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      input({
        config: {
          version: 1,
          shippingDiscounts: [
            {
              id: "bfdeal4-free-express",
              enabled: true,
              conditions: {
                discountCodeIncludes: ["BFDEAL4"],
                cartTotalQuantity: {
                  comparison: "greater_than_or_equal",
                  amount: 4,
                },
              },
              rateSelector: {
                type: "deliveryOptionsWhereTitleIncludes",
                values: ["express"],
              },
              discount: {
                type: "percentage",
                value: 100,
                message: "BFDEAL4 - Free Express Shipping",
              },
            },
          ],
        },
        discountCodes: ["BFDEAL4"],
        lines: [productLine({ quantity: 4 })],
        deliveryOptions: [
          { handle: "priority", title: "Priority Handling" },
          { handle: "express", title: "DHL Express" },
        ],
      }),
    );

    expect(result.operations[0].deliveryDiscountsAdd.candidates[0]).toMatchObject({
      message: "BFDEAL4 - Free Express Shipping",
      targets: [
        {
          deliveryOption: {
            handle: "express",
          },
        },
      ],
    });
  });

  test("uses product tags from dynamic function input variables", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      input({
        config: {
          version: 1,
          productTags: ["ops_campaign_tag"],
          shippingDiscounts: [
            {
              id: "dynamic-tag-free-standard",
              enabled: true,
              conditions: {
                lineProductTagQuantity: {
                  comparison: "greater_than_or_equal",
                  amount: 1,
                  match: "match",
                  tags: ["ops_campaign_tag"],
                },
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
        lines: [productLine({ dynamicTags: [{ tag: "ops_campaign_tag", hasTag: true }] })],
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping" },
          { handle: "express", title: "Express Shipping" },
        ],
      }),
    );

    expect(result.operations[0].deliveryDiscountsAdd.candidates[0]).toMatchObject({
      message: "Free Shipping",
      targets: [
        {
          deliveryOption: {
            handle: "standard",
          },
        },
      ],
    });
  });

  test("discounts standard shipping for a newly declared Has_Variant product tag", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      input({
        config: {
          version: 1,
          productTags: ["box_shipping", "subs_box_mvp", "bf22_exc", "ACTIVEJEWELRY50", "Has_Variant"],
          shippingDiscounts: [
            {
              id: "has-variant-free-standard",
              enabled: true,
              conditions: {
                lineProductTagQuantity: {
                  comparison: "greater_than_or_equal",
                  amount: 1,
                  match: "match",
                  tags: ["Has_Variant"],
                },
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
        lines: [productLine({ dynamicTags: [{ tag: "Has_Variant", hasTag: true }] })],
        deliveryOptions: [
          { handle: "standard-eco", title: "Standard eco Delivery (5 to 10 business days)" },
          { handle: "standard", title: "Standard Shipping EU (2 to 7 business days)" },
          { handle: "express", title: "DHL Express Delivery" },
        ],
      }),
    );

    expect(result.operations[0].deliveryDiscountsAdd.candidates[0]).toMatchObject({
      message: "Free Shipping",
      targets: [
        {
          deliveryOption: {
            handle: "standard-eco",
          },
        },
        {
          deliveryOption: {
            handle: "standard",
          },
        },
      ],
    });
  });

  test("matches dynamic product tags case-insensitively once Shopify returns them", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      input({
        config: {
          version: 1,
          productTags: ["Has_Variant"],
          shippingDiscounts: [
            {
              id: "case-insensitive-dynamic-tag",
              enabled: true,
              conditions: {
                lineProductTagQuantity: {
                  comparison: "greater_than_or_equal",
                  amount: 1,
                  match: "match",
                  tags: ["has_variant"],
                },
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
        lines: [productLine({ dynamicTags: [{ tag: "Has_Variant", hasTag: true }] })],
        deliveryOptions: [{ handle: "standard", title: "Standard Shipping EU" }],
      }),
    );

    expect(result.operations[0].deliveryDiscountsAdd.candidates[0].targets).toEqual([
      {
        deliveryOption: {
          handle: "standard",
        },
      },
    ]);
  });
});
