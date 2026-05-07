import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cartValidationsGenerateRun } from "../extensions/hh-checkout-validation/src/cart_validations_generate_run.js";
import { cartDeliveryOptionsDiscountsGenerateRun } from "../extensions/hh-shipping-discount/src/cart_delivery_options_discounts_generate_run.js";
import { cartDeliveryOptionsTransformRun } from "../extensions/hh-delivery-customization/src/cart_delivery_options_transform_run.js";
import {
  compileProductionRuleFile,
  productionRuleFiles,
} from "../scripts/production-rules-shared.mjs";

const configs = new Map(
  productionRuleFiles().map((ruleFile) => [
    ruleFile.store,
    compileProductionRuleFile(ruleFile).config,
  ]),
);

function config(store) {
  const storeConfig = configs.get(store);
  if (!storeConfig) throw new Error(`Missing compiled config for ${store}.`);
  return storeConfig;
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

function deliveryInput({ store, discountCodes = [], subtotal = 42, lines = [], countryCode = "PT", deliveryOptions }) {
  return {
    deliveryCustomization: {
      metafield: {
        jsonValue: config(store),
      },
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
            countryCode,
          },
          deliveryOptions,
        },
      ],
    },
  };
}

function discountInput({
  store,
  discountCodes = [],
  subtotal = 42,
  lines = [],
  countryCode = "PT",
  deliveryOptions,
  discountClasses = ["SHIPPING"],
}) {
  return {
    discount: {
      discountClasses,
      metafield: {
        jsonValue: config(store),
      },
    },
    cart: {
      discountCodes: { value: JSON.stringify(discountCodes) },
      cost: {
        subtotalAmount: {
          amount: String(subtotal),
        },
      },
      lines,
      deliveryGroups: [
        {
          id: "gid://shopify/CartDeliveryGroup/1",
          deliveryAddress: {
            countryCode,
          },
          deliveryOptions,
        },
      ],
    },
  };
}

function validationInput({ store, discountCodes = [], subtotal = 42, lines = [productLine()] }) {
  return {
    validation: {
      metafield: {
        jsonValue: config(store),
      },
    },
    buyerJourney: {
      step: "CHECKOUT_INTERACTION",
    },
    cart: {
      discountCodes: { value: JSON.stringify(discountCodes) },
      cost: {
        subtotalAmount: {
          amount: String(subtotal),
        },
      },
      lines,
    },
  };
}

describe("production runtime golden snapshots", () => {
  test("EU HHCSF hides eco delivery rates", () => {
    const result = cartDeliveryOptionsTransformRun(
      deliveryInput({
        store: "hey-harper-shop-nl.myshopify.com",
        discountCodes: ["HHCSF272933_2"],
        deliveryOptions: [
          { handle: "eco", title: "Standard eco Delivery (5 to 10 business days)" },
          { handle: "standard", title: "Standard Shipping EU (2 to 7 business days)" },
          { handle: "express", title: "DHL Express Delivery" },
        ],
      }),
    );

    assert.deepEqual(result, {
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "eco",
          },
        },
      ],
    });
  });

  test("EU GOLDJOY shows only subscription rates", () => {
    const result = cartDeliveryOptionsTransformRun(
      deliveryInput({
        store: "hey-harper-shop-nl.myshopify.com",
        discountCodes: ["GOLDJOY"],
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping EU" },
          { handle: "priority", title: "Priority Handling EU" },
          { handle: "subscription", title: "Ships with your next subscription renewal" },
        ],
      }),
    );

    assert.deepEqual(result, {
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "standard",
          },
        },
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "priority",
          },
        },
      ],
    });
  });

  test("EU NOMORERUST zero-subtotal cart hides all delivery rates", () => {
    const result = cartDeliveryOptionsTransformRun(
      deliveryInput({
        store: "hey-harper-shop-nl.myshopify.com",
        discountCodes: ["NOMORERUST"],
        subtotal: 0,
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping EU" },
          { handle: "express", title: "DHL Express Delivery" },
        ],
      }),
    );

    assert.deepEqual(result, {
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

  test("EU subscription product discounts standard shipping", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      discountInput({
        store: "hey-harper-shop-nl.myshopify.com",
        lines: [productLine({ subsBoxMvp: true })],
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping EU" },
          { handle: "priority", title: "Priority Handling EU" },
        ],
      }),
    );

    assert.deepEqual(result, {
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

  test("UK BFDEAL4 with 4 items discounts express shipping", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      discountInput({
        store: "hey-harper-shop-uk.myshopify.com",
        discountCodes: ["BFDEAL4"],
        lines: [productLine({ quantity: 4 })],
        countryCode: "GB",
        deliveryOptions: [
          { handle: "priority", title: "Priority Handling UK" },
          { handle: "express", title: "DHL Express Delivery" },
        ],
      }),
    );

    assert.deepEqual(result, {
      operations: [
        {
          deliveryDiscountsAdd: {
            candidates: [
              {
                message: "Free Priority Handling (3+ Items)",
                targets: [
                  {
                    deliveryOption: {
                      handle: "priority",
                    },
                  },
                ],
                value: {
                  percentage: {
                    value: 100,
                  },
                },
              },
              {
                message: "BFDEAL4 - Free Express Shipping",
                targets: [
                  {
                    deliveryOption: {
                      handle: "express",
                    },
                  },
                ],
                value: {
                  percentage: {
                    value: 100,
                  },
                },
              },
              {
                message: "BFDEAL 4 - Free Priority Shipping",
                targets: [
                  {
                    deliveryOption: {
                      handle: "priority",
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

  test("UK large carts hide letterbox and keep standard UK", () => {
    const result = cartDeliveryOptionsTransformRun(
      deliveryInput({
        store: "hey-harper-shop-uk.myshopify.com",
        lines: [productLine({ quantity: 6 })],
        countryCode: "GB",
        deliveryOptions: [
          { handle: "letterbox", title: "Letterbox Delivery" },
          { handle: "standard-uk", title: "Standard UK" },
          { handle: "express", title: "Express UK" },
        ],
      }),
    );

    assert.deepEqual(result, {
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "letterbox",
          },
        },
      ],
    });
  });

  test("US 5 qualifying items discount priority shipping", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      discountInput({
        store: "hey-harper-shop-us.myshopify.com",
        lines: [productLine({ quantity: 5 })],
        countryCode: "US",
        deliveryOptions: [
          { handle: "standard", title: "Standard Shipping US" },
          { handle: "priority", title: "Priority Handling US" },
        ],
      }),
    );

    assert.deepEqual(result, {
      operations: [
        {
          deliveryDiscountsAdd: {
            candidates: [
              {
                message: "Free Priority Handling (3+ Items)",
                targets: [
                  {
                    deliveryOption: {
                      handle: "priority",
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

  test("NOMORERUST validation blocks zero-subtotal carts in every production store", () => {
    for (const store of configs.keys()) {
      const result = cartValidationsGenerateRun(
        validationInput({
          store,
          discountCodes: ["NOMORERUST"],
          subtotal: 0,
        }),
      );

      assert.deepEqual(result, {
        operations: [
          {
            validationAdd: {
              errors: [
                {
                  message: "NOMORERUST must be used with at least one paid jewelry item.",
                  target: "$.cart",
                },
              ],
            },
          },
        ],
      });
    }
  });

  test("missing runtime config fails open for all functions", () => {
    assert.deepEqual(
      cartDeliveryOptionsTransformRun({
        deliveryCustomization: { metafield: null },
        cart: {
          discountCodes: { value: "[]" },
          cost: { subtotalAmount: { amount: "42" } },
          lines: [],
          deliveryGroups: [
            {
              deliveryOptions: [{ handle: "standard", title: "Standard Shipping" }],
            },
          ],
        },
      }),
      { operations: [] },
    );

    assert.deepEqual(
      cartDeliveryOptionsDiscountsGenerateRun({
        discount: { discountClasses: ["SHIPPING"], metafield: null },
        cart: {
          discountCodes: { value: "[]" },
          cost: { subtotalAmount: { amount: "42" } },
          lines: [],
          deliveryGroups: [
            {
              id: "gid://shopify/CartDeliveryGroup/1",
              deliveryOptions: [{ handle: "standard", title: "Standard Shipping" }],
            },
          ],
        },
      }),
      { operations: [] },
    );

    assert.deepEqual(
      cartValidationsGenerateRun({
        validation: { metafield: null },
        cart: {
          discountCodes: { value: "[]" },
          cost: { subtotalAmount: { amount: "42" } },
          lines: [],
        },
      }),
      { operations: [{ validationAdd: { errors: [] } }] },
    );
  });
});
