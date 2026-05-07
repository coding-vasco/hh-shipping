import { describe, expect, test } from "vitest";
import { cartValidationsGenerateRun } from "../src/cart_validations_generate_run.js";

function input({ subtotal, discountCodes = ["NOMORERUST"] }) {
  return {
    validation: {
      metafield: {
        jsonValue: {
          version: 1,
          validations: [
            {
              enabled: true,
              id: "nomorerust-requires-paid-jewelry",
              message: "NOMORERUST must be used with at least one paid jewelry item.",
              target: "$.cart",
              conditions: {
                discountCodeIncludes: ["NOMORERUST"],
                subtotal: {
                  comparison: "equal_to",
                  amount: 0,
                },
              },
            },
          ],
        },
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
      lines: [
        {
          quantity: 1,
          merchandise: {
            product: {
              boxShipping: false,
              subsBoxMvp: false,
              bf22Exc: false,
            },
          },
        },
      ],
    },
  };
}

describe("checkout validation rules", () => {
  test("missing config fails open", () => {
    const result = cartValidationsGenerateRun({
      validation: {
        metafield: null,
      },
      cart: {
        discountCodes: { value: "[\"NOMORERUST\"]" },
        cost: {
          subtotalAmount: {
            amount: "0",
          },
        },
        lines: [],
      },
    });

    expect(result).toEqual({
      operations: [
        {
          validationAdd: {
            errors: [],
          },
        },
      ],
    });
  });

  test("malformed config fails open", () => {
    const result = cartValidationsGenerateRun({
      validation: {
        metafield: {
          jsonValue: {
            version: 1,
            validations: [
              null,
              {
                id: "missing-message",
                enabled: true,
                target: "$.cart",
                conditions: {
                  discountCodeIncludes: ["NOMORERUST"],
                  subtotal: {
                    comparison: "equal_to",
                    amount: 0,
                  },
                },
              },
            ],
          },
        },
      },
      cart: {
        discountCodes: { value: "[\"NOMORERUST\"]" },
        cost: {
          subtotalAmount: {
            amount: "0",
          },
        },
        lines: [],
      },
    });

    expect(result).toEqual({
      operations: [
        {
          validationAdd: {
            errors: [],
          },
        },
      ],
    });
  });

  test("blocks NOMORERUST carts with zero subtotal", () => {
    const result = cartValidationsGenerateRun(input({ subtotal: 0 }));

    expect(result).toEqual({
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
  });

  test("allows NOMORERUST carts with paid subtotal", () => {
    const result = cartValidationsGenerateRun(input({ subtotal: 12 }));

    expect(result).toEqual({
      operations: [
        {
          validationAdd: {
            errors: [],
          },
        },
      ],
    });
  });

  test("allows zero subtotal carts without NOMORERUST", () => {
    const result = cartValidationsGenerateRun(input({ subtotal: 0, discountCodes: ["OTHER"] }));

    expect(result).toEqual({
      operations: [
        {
          validationAdd: {
            errors: [],
          },
        },
      ],
    });
  });
});
