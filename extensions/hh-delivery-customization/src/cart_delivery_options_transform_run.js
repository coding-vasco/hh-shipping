// @ts-check

/**
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunInput} CartDeliveryOptionsTransformRunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunResult} CartDeliveryOptionsTransformRunResult
 */

function searchableDeliveryOptionText(deliveryOption) {
  return `${deliveryOption.title ?? ""} ${deliveryOption.handle ?? ""}`.toLowerCase();
}

/**
 * @param {CartDeliveryOptionsTransformRunInput} input
 * @returns {CartDeliveryOptionsTransformRunResult}
 */
export function cartDeliveryOptionsTransformRun(input) {
  const operations = [];
  const hiddenHandles = new Set();

  const campaign = (input.cart.shippingCampaign?.value ?? "normal").toLowerCase();
  const hideEco = (input.cart.hideEco?.value ?? "false").toLowerCase() === "true";

  for (const deliveryGroup of input.cart.deliveryGroups) {
    for (const deliveryOption of deliveryGroup.deliveryOptions) {
      const optionText = searchableDeliveryOptionText(deliveryOption);
      const isSubscription = optionText.includes("subscription");
      const isEco = optionText.includes("eco");

      let shouldHide = false;

      if (campaign === "subscription_only") {
        shouldHide = !isSubscription;
      } else {
        shouldHide = isSubscription;
      }

      if (hideEco && isEco) {
        shouldHide = true;
      }

      if (shouldHide && !hiddenHandles.has(deliveryOption.handle)) {
        hiddenHandles.add(deliveryOption.handle);

        operations.push({
          deliveryOptionHide: {
            deliveryOptionHandle: deliveryOption.handle,
          },
        });
      }
    }
  }

  return {operations};
}
