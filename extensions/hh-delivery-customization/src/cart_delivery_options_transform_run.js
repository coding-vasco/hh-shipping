// @ts-check

/**
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunInput} CartDeliveryOptionsTransformRunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunResult} CartDeliveryOptionsTransformRunResult
 */

const FALLBACK_RULES = {
  version: 1,
  rules: [
    {
      id: "vip-goldjoy-subscription-only",
      enabled: true,
      conditions: { discountCodeIncludes: ["VIP50", "GOLDJOY"] },
      actions: [
        {
          type: "hideDeliveryOptionsWhereTitleDoesNotInclude",
          values: ["subscription"],
        },
      ],
    },
    {
      id: "normal-hide-subscription",
      enabled: true,
      conditions: { noDiscountCode: true },
      actions: [
        {
          type: "hideDeliveryOptionsWhereTitleIncludes",
          values: ["subscription"],
        },
      ],
    },
    {
      id: "non-campaign-hide-subscription",
      enabled: true,
      conditions: { discountCodeDoesNotInclude: ["VIP50", "GOLDJOY"] },
      actions: [
        {
          type: "hideDeliveryOptionsWhereTitleIncludes",
          values: ["subscription"],
        },
      ],
    },
    {
      id: "hhcsf-hide-eco",
      enabled: true,
      conditions: { discountCodeIncludes: ["HHCSF"] },
      actions: [
        {
          type: "hideDeliveryOptionsWhereTitleIncludes",
          values: ["eco"],
        },
      ],
    },
  ],
};

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function lowerList(value) {
  return Array.isArray(value) ? value.map((item) => lower(item)).filter(Boolean) : [];
}

function anyIncludes(haystacks, needles) {
  const normalizedNeedles = lowerList(needles);
  if (normalizedNeedles.length === 0) return false;
  return haystacks.some((haystack) =>
    normalizedNeedles.some((needle) => lower(haystack).includes(needle)),
  );
}

function optionText(deliveryOption) {
  return `${deliveryOption.title ?? ""} ${deliveryOption.handle ?? ""}`.toLowerCase();
}

function parseDiscountCodes(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((code) => String(code)) : [];
  } catch {
    return String(value)
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean);
  }
}

function cartSignals(input) {
  const discountCodes = parseDiscountCodes(input.cart.discountCodes?.value);
  const lines = input.cart.lines ?? [];
  const knownTags = [];

  for (const line of lines) {
    const product = line.merchandise?.product;
    if (!product) continue;
    if (product.boxShipping) knownTags.push("box_shipping");
    if (product.subsBoxMvp) knownTags.push("subs_box_mvp");
    if (product.bf22Exc) knownTags.push("bf22_exc");
  }

  return {
    discountCodes,
    subtotal: Number(input.cart.cost?.subtotalAmount?.amount ?? 0),
    totalQuantity: lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0),
    knownTags,
  };
}

function matchesConditions(rule, signals, deliveryGroup, deliveryOption) {
  const conditions = rule.conditions ?? {};
  const text = optionText(deliveryOption);
  const countryCode = lower(deliveryGroup.deliveryAddress?.countryCode);

  if (conditions.noDiscountCode === true && signals.discountCodes.length > 0) {
    return false;
  }

  if (
    Array.isArray(conditions.discountCodeIncludes) &&
    !anyIncludes(signals.discountCodes, conditions.discountCodeIncludes)
  ) {
    return false;
  }

  if (
    Array.isArray(conditions.discountCodeDoesNotInclude) &&
    anyIncludes(signals.discountCodes, conditions.discountCodeDoesNotInclude)
  ) {
    return false;
  }

  if (
    Array.isArray(conditions.deliveryTitleIncludes) &&
    !anyIncludes([text], conditions.deliveryTitleIncludes)
  ) {
    return false;
  }

  if (
    Array.isArray(conditions.deliveryTitleDoesNotInclude) &&
    anyIncludes([text], conditions.deliveryTitleDoesNotInclude)
  ) {
    return false;
  }

  if (
    typeof conditions.cartTotalQuantityGreaterThan === "number" &&
    !(signals.totalQuantity > conditions.cartTotalQuantityGreaterThan)
  ) {
    return false;
  }

  if (
    typeof conditions.cartTotalQuantityLessThanOrEqual === "number" &&
    !(signals.totalQuantity <= conditions.cartTotalQuantityLessThanOrEqual)
  ) {
    return false;
  }

  if (
    typeof conditions.subtotalGreaterThan === "number" &&
    !(signals.subtotal > conditions.subtotalGreaterThan)
  ) {
    return false;
  }

  if (
    typeof conditions.subtotalLessThan === "number" &&
    !(signals.subtotal < conditions.subtotalLessThan)
  ) {
    return false;
  }

  if (
    Array.isArray(conditions.countryCodeIs) &&
    !lowerList(conditions.countryCodeIs).includes(countryCode)
  ) {
    return false;
  }

  if (
    Array.isArray(conditions.lineProductTagIncludes) &&
    !anyIncludes(signals.knownTags, conditions.lineProductTagIncludes)
  ) {
    return false;
  }

  if (
    Array.isArray(conditions.lineProductTagDoesNotInclude) &&
    anyIncludes(signals.knownTags, conditions.lineProductTagDoesNotInclude)
  ) {
    return false;
  }

  return true;
}

function actionHidesDeliveryOption(action, deliveryOption) {
  const text = optionText(deliveryOption);

  switch (action.type) {
    case "hideAllDeliveryOptions":
      return true;
    case "hideDeliveryOptionsWhereTitleIncludes":
      return anyIncludes([text], action.values);
    case "hideDeliveryOptionsWhereTitleDoesNotInclude":
      return !anyIncludes([text], action.values);
    default:
      return false;
  }
}

function rulesConfig(input) {
  const config = input.deliveryCustomization?.metafield?.jsonValue;
  if (config?.version === 1 && Array.isArray(config.rules)) {
    return config;
  }

  return FALLBACK_RULES;
}

/**
 * @param {CartDeliveryOptionsTransformRunInput} input
 * @returns {CartDeliveryOptionsTransformRunResult}
 */
export function cartDeliveryOptionsTransformRun(input) {
  const operations = [];
  const hiddenHandles = new Set();
  const config = rulesConfig(input);
  const signals = cartSignals(input);

  for (const deliveryGroup of input.cart.deliveryGroups) {
    for (const deliveryOption of deliveryGroup.deliveryOptions) {
      const shouldHide = config.rules.some((rule) => {
        if (rule.enabled === false) return false;
        if (!matchesConditions(rule, signals, deliveryGroup, deliveryOption)) return false;
        return (rule.actions ?? []).some((action) => actionHidesDeliveryOption(action, deliveryOption));
      });

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

  return { operations };
}
