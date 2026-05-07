// @ts-check

/**
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunInput} CartDeliveryOptionsTransformRunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunResult} CartDeliveryOptionsTransformRunResult
 */

const EMPTY_RULES = { version: 1, rules: [] };

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
  const cart = input.cart ?? {};
  const discountCodes = parseDiscountCodes(cart.discountCodes?.value);
  const lines = Array.isArray(cart.lines) ? cart.lines : [];
  const knownTags = [];
  const taggedLines = [];

  for (const line of lines) {
    const product = line.merchandise?.product;
    if (!product) continue;
    const tags = [];
    if (product.boxShipping) knownTags.push("box_shipping");
    if (product.boxShipping) tags.push("box_shipping");
    if (product.subsBoxMvp) {
      knownTags.push("subs_box_mvp");
      tags.push("subs_box_mvp");
    }
    if (product.bf22Exc) {
      knownTags.push("bf22_exc");
      tags.push("bf22_exc");
    }
    taggedLines.push({ quantity: line.quantity ?? 0, tags });
  }

  return {
    discountCodes,
    subtotal: Number(cart.cost?.subtotalAmount?.amount ?? 0),
    totalQuantity: lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0),
    knownTags,
    taggedLines,
  };
}

function compareNumber(value, comparison, amount) {
  switch (comparison) {
    case "greater_than":
      return value > amount;
    case "greater_than_or_equal":
      return value >= amount;
    case "less_than":
      return value < amount;
    case "less_than_or_equal":
      return value <= amount;
    case "equal_to":
      return value === amount;
    default:
      return false;
  }
}

function taggedQuantity(signals, condition) {
  const tags = lowerList(condition?.tags);
  if (tags.length === 0) return 0;

  return signals.taggedLines.reduce((sum, line) => {
    const lineTags = lowerList(line.tags);
    const hasTag = tags.some((tag) => lineTags.includes(tag));
    const matches = condition.match === "does_not_match" ? !hasTag : hasTag;
    return matches ? sum + line.quantity : sum;
  }, 0);
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
    conditions.cartTotalQuantity &&
    !compareNumber(signals.totalQuantity, conditions.cartTotalQuantity.comparison, conditions.cartTotalQuantity.amount)
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

  if (conditions.subtotal && !compareNumber(signals.subtotal, conditions.subtotal.comparison, conditions.subtotal.amount)) {
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

  if (
    conditions.lineProductTagQuantity &&
    !compareNumber(
      taggedQuantity(signals, conditions.lineProductTagQuantity),
      conditions.lineProductTagQuantity.comparison,
      conditions.lineProductTagQuantity.amount,
    )
  ) {
    return false;
  }

  return true;
}

function actionHidesDeliveryOption(action, deliveryOption) {
  const text = optionText(deliveryOption);

  switch (action?.type) {
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

  return EMPTY_RULES;
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
  const deliveryGroups = Array.isArray(input.cart?.deliveryGroups) ? input.cart.deliveryGroups : [];

  for (const deliveryGroup of deliveryGroups) {
    const deliveryOptions = Array.isArray(deliveryGroup.deliveryOptions) ? deliveryGroup.deliveryOptions : [];
    for (const deliveryOption of deliveryOptions) {
      const shouldHide = config.rules.some((rule) => {
        if (!rule || typeof rule !== "object") return false;
        if (rule.enabled === false) return false;
        if (!matchesConditions(rule, signals, deliveryGroup, deliveryOption)) return false;
        const actions = Array.isArray(rule.actions) ? rule.actions : [];
        return actions.some((action) => actionHidesDeliveryOption(action, deliveryOption));
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
