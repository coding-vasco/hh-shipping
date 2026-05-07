// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

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
  const lines = Array.isArray(cart.lines) ? cart.lines : [];
  const knownTags = [];
  const taggedLines = [];

  for (const line of lines) {
    const product = line.merchandise?.product;
    if (!product) continue;
    const tags = [];
    if (product.boxShipping) {
      knownTags.push("box_shipping");
      tags.push("box_shipping");
    }
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
    discountCodes: parseDiscountCodes(cart.discountCodes?.value),
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

function matchesConditions(rule, signals) {
  const conditions = rule.conditions ?? {};

  if (conditions.noDiscountCode === true && signals.discountCodes.length > 0) return false;
  if (Array.isArray(conditions.discountCodeIncludes) && !anyIncludes(signals.discountCodes, conditions.discountCodeIncludes)) {
    return false;
  }
  if (
    Array.isArray(conditions.discountCodeDoesNotInclude) &&
    anyIncludes(signals.discountCodes, conditions.discountCodeDoesNotInclude)
  ) {
    return false;
  }
  if (
    conditions.cartTotalQuantity &&
    !compareNumber(signals.totalQuantity, conditions.cartTotalQuantity.comparison, conditions.cartTotalQuantity.amount)
  ) {
    return false;
  }
  if (conditions.subtotal && !compareNumber(signals.subtotal, conditions.subtotal.comparison, conditions.subtotal.amount)) {
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

function rulesConfig(input) {
  const config = input.validation?.metafield?.jsonValue;
  if (config?.version === 1 && Array.isArray(config.validations)) {
    return config;
  }

  return { version: 1, validations: [] };
}

/**
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const config = rulesConfig(input);
  const signals = cartSignals(input);
  const errors = [];

  for (const rule of config.validations) {
    if (!rule || typeof rule !== "object") continue;
    if (rule.enabled === false) continue;
    if (!matchesConditions(rule, signals)) continue;

    if (typeof rule.message !== "string" || !rule.message.trim()) continue;

    errors.push({
      message: rule.message,
      target: rule.target ?? "$.cart",
    });
  }

  return {
    operations: [
      {
        validationAdd: {
          errors,
        },
      },
    ],
  };
}
