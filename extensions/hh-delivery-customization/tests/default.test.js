import {describe, expect, test} from "vitest";
import {cartDeliveryOptionsTransformRun} from "../src/cart_delivery_options_transform_run.js";

function input({campaign, hideEco, deliveryOptions}) {
  return {
    cart: {
      shippingCampaign: campaign ? {value: campaign} : null,
      hideEco: hideEco ? {value: hideEco} : null,
      deliveryGroups: [
        {
          deliveryOptions,
        },
      ],
    },
  };
}

describe("delivery customization rules", () => {
  test("normal carts hide subscription delivery options", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        campaign: "normal",
        hideEco: "false",
        deliveryOptions: [
          {handle: "standard", title: "Standard Shipping"},
          {handle: "subscription", title: "Subscription Delivery"},
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

  test("subscription campaigns hide non-subscription delivery options", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        campaign: "subscription_only",
        hideEco: "false",
        deliveryOptions: [
          {handle: "standard", title: "Standard Shipping"},
          {handle: "subscription", title: "Subscription Delivery"},
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

  test("HHCSF flag hides eco delivery options", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        campaign: "normal",
        hideEco: "true",
        deliveryOptions: [
          {handle: "standard", title: "Standard Shipping"},
          {handle: "eco", title: "Eco Delivery"},
          {handle: "subscription", title: "Subscription Delivery"},
        ],
      }),
    );

    expect(result).toEqual({
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "eco",
          },
        },
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "subscription",
          },
        },
      ],
    });
  });

  test("matches delivery option handle as well as title", () => {
    const result = cartDeliveryOptionsTransformRun(
      input({
        campaign: "subscription_only",
        hideEco: "true",
        deliveryOptions: [
          {handle: "carrier-standard-eco", title: "Free Shipping"},
          {handle: "carrier-subscription", title: "Free Shipping"},
        ],
      }),
    );

    expect(result).toEqual({
      operations: [
        {
          deliveryOptionHide: {
            deliveryOptionHandle: "carrier-standard-eco",
          },
        },
      ],
    });
  });
});
