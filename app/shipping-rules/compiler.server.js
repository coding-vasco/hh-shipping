import vm from "node:vm";

const SUPPORTED_PRODUCT_TAGS = new Set(["box_shipping", "subs_box_mvp", "bf22_exc"]);

export const DEFAULT_RULES_SCRIPT = `// HH shipping rules Phase 1
// Product tags must also be wired in the Delivery Customization Function input query.
settings({
  productTags: ["box_shipping", "subs_box_mvp", "bf22_exc"],
});

campaigns([
  ShippingDiscount({
    name: "Subscription free standard shipping",
    condition: "all",
    qualifiers: [
      CartHasItemQualifier({
        comparison: "greater_than_or_equal",
        amount: 1,
        selector: ProductTagSelector({ match: "match", tags: ["subs_box_mvp"] }),
      }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["standard"] }),
    discount: PercentageDiscount({ percent: 100, message: "Free Shipping" }),
  }),

  HideRates({
    name: "VIP50/GOLDJOY subscription only",
    condition: "all",
    qualifiers: [
      CodeQualifier({ match: "include", codes: ["VIP50", "GOLDJOY"] }),
    ],
    rateSelector: RateNameSelector({
      match: "does_not_include",
      names: ["subscription"],
    }),
  }),

  HideRates({
    name: "Normal carts hide subscription",
    condition: "any",
    qualifiers: [
      NoDiscountCodeQualifier(),
      CodeQualifier({ match: "does_not_include", codes: ["VIP50", "GOLDJOY"] }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["subscription"] }),
  }),

  HideRates({
    name: "HHCSF hides eco",
    condition: "all",
    qualifiers: [
      CodeQualifier({ match: "include", codes: ["HHCSF"] }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["eco"] }),
  }),
]);`;

export const DEFAULT_RULES = compileRulesScript(DEFAULT_RULES_SCRIPT).config;

export function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function descriptor(type, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${type} expects an object.`);
  }

  return Object.freeze({ type, ...input });
}

function createDslContext() {
  let appSettings = {};
  let appCampaigns = null;

  const helpers = {
    settings(input) {
      appSettings = descriptor("settings", input);
      return appSettings;
    },
    campaigns(input) {
      if (!Array.isArray(input)) {
        throw new Error("campaigns(...) expects an array.");
      }
      appCampaigns = input;
      return appCampaigns;
    },
    HideRates: (input) => descriptor("HideRates", input),
    ShippingDiscount: (input) => descriptor("ShippingDiscount", input),
    CartValidation: (input) => descriptor("CartValidation", input),
    CodeQualifier: (input) => descriptor("CodeQualifier", input),
    NoDiscountCodeQualifier: (input = {}) => descriptor("NoDiscountCodeQualifier", input),
    CartQuantityQualifier: (input) => descriptor("CartQuantityQualifier", input),
    CartSubtotalQualifier: (input) => descriptor("CartSubtotalQualifier", input),
    CartHasItemQualifier: (input) => descriptor("CartHasItemQualifier", input),
    CountryCodeQualifier: (input) => descriptor("CountryCodeQualifier", input),
    ProductTagSelector: (input) => descriptor("ProductTagSelector", input),
    RateNameSelector: (input) => descriptor("RateNameSelector", input),
    AllRatesSelector: (input = {}) => descriptor("AllRatesSelector", input),
    PercentageDiscount: (input) => descriptor("PercentageDiscount", input),
    FixedAmountDiscount: (input) => descriptor("FixedAmountDiscount", input),
    __hhGetResult: () => ({ settings: appSettings, campaigns: appCampaigns }),
  };

  return vm.createContext(Object.freeze({ ...helpers }), {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });
}

function asStringArray(value, path, errors) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim())) {
    errors.push(`${path} must be a non-empty array of strings.`);
    return [];
  }

  return Array.from(value, (item) => item.trim());
}

function assertMatch(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}.`);
    return allowed[0];
  }

  return value;
}

function assertNumber(value, path, errors) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${path} must be a number.`);
    return 0;
  }

  return value;
}

function slugify(value, fallback) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function compileQualifier(qualifier, path, errors) {
  if (!qualifier || typeof qualifier !== "object") {
    errors.push(`${path} must be a qualifier.`);
    return {};
  }

  switch (qualifier.type) {
    case "CodeQualifier": {
      const match = assertMatch(qualifier.match, ["include", "does_not_include"], `${path}.match`, errors);
      const codes = asStringArray(qualifier.codes, `${path}.codes`, errors);
      return match === "include"
        ? { discountCodeIncludes: codes }
        : { discountCodeDoesNotInclude: codes };
    }
    case "NoDiscountCodeQualifier":
      return { noDiscountCode: true };
    case "CartQuantityQualifier": {
      const comparison = assertMatch(
        qualifier.comparison,
        ["greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "equal_to"],
        `${path}.comparison`,
        errors,
      );
      const amount = assertNumber(qualifier.amount, `${path}.amount`, errors);
      return { cartTotalQuantity: { comparison, amount } };
    }
    case "CartSubtotalQualifier": {
      const comparison = assertMatch(
        qualifier.comparison,
        ["greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "equal_to"],
        `${path}.comparison`,
        errors,
      );
      const amount = assertNumber(qualifier.amount, `${path}.amount`, errors);
      return { subtotal: { comparison, amount } };
    }
    case "CountryCodeQualifier": {
      assertMatch(qualifier.match ?? "one_of", ["one_of"], `${path}.match`, errors);
      return { countryCodeIs: asStringArray(qualifier.countryCodes, `${path}.countryCodes`, errors) };
    }
    case "CartHasItemQualifier": {
      if (!qualifier.selector || qualifier.selector.type !== "ProductTagSelector") {
        errors.push(`${path}.selector must be ProductTagSelector(...).`);
        return {};
      }

      const selector = qualifier.selector;
      const comparison = assertMatch(
        qualifier.comparison,
        ["greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "equal_to"],
        `${path}.comparison`,
        errors,
      );
      const amount = assertNumber(qualifier.amount, `${path}.amount`, errors);
      const match = assertMatch(selector.match, ["match", "does_not_match"], `${path}.selector.match`, errors);
      const tags = asStringArray(selector.tags, `${path}.selector.tags`, errors);
      return {
        lineProductTagQuantity: {
          comparison,
          amount,
          match,
          tags,
        },
      };
    }
    default:
      errors.push(`${path}.type is not a supported qualifier.`);
      return {};
  }
}

function compileRateSelector(selector, path, errors) {
  if (!selector || typeof selector !== "object") {
    errors.push(`${path} is required.`);
    return { type: "hideAllDeliveryOptions" };
  }

  if (selector.type === "AllRatesSelector") {
    return { type: "hideAllDeliveryOptions" };
  }

  if (selector.type !== "RateNameSelector") {
    errors.push(`${path}.type must be RateNameSelector or AllRatesSelector.`);
    return { type: "hideAllDeliveryOptions" };
  }

  const match = assertMatch(selector.match, ["include", "does_not_include"], `${path}.match`, errors);
  const values = asStringArray(selector.names, `${path}.names`, errors);

  return match === "include"
    ? { type: "hideDeliveryOptionsWhereTitleIncludes", values }
    : { type: "hideDeliveryOptionsWhereTitleDoesNotInclude", values };
}

function compileDeliveryTargetSelector(selector, path, errors) {
  const action = compileRateSelector(selector, path, errors);

  switch (action.type) {
    case "hideAllDeliveryOptions":
      return { type: "allDeliveryOptions" };
    case "hideDeliveryOptionsWhereTitleIncludes":
      return { type: "deliveryOptionsWhereTitleIncludes", values: action.values };
    case "hideDeliveryOptionsWhereTitleDoesNotInclude":
      return { type: "deliveryOptionsWhereTitleDoesNotInclude", values: action.values };
    default:
      errors.push(`${path}.type is not supported for shipping discounts.`);
      return { type: "allDeliveryOptions" };
  }
}

function compileDiscount(discount, path, errors) {
  if (!discount || typeof discount !== "object") {
    errors.push(`${path} is required.`);
    return { type: "percentage", value: 0, message: "" };
  }

  switch (discount.type) {
    case "PercentageDiscount": {
      const percent = assertNumber(discount.percent, `${path}.percent`, errors);
      if (percent < 0 || percent > 100) {
        errors.push(`${path}.percent must be between 0 and 100.`);
      }
      return {
        type: "percentage",
        value: percent,
        message: String(discount.message ?? ""),
      };
    }
    case "FixedAmountDiscount": {
      const amount = assertNumber(discount.amount, `${path}.amount`, errors);
      if (amount < 0) {
        errors.push(`${path}.amount must be greater than or equal to 0.`);
      }
      return {
        type: "fixedAmount",
        amount,
        message: String(discount.message ?? ""),
      };
    }
    default:
      errors.push(`${path}.type must be PercentageDiscount or FixedAmountDiscount.`);
      return { type: "percentage", value: 0, message: "" };
  }
}

function validateSettings(settingsValue, errors) {
  const tags = settingsValue?.productTags ?? [];
  if (!Array.isArray(tags)) {
    errors.push("settings.productTags must be an array.");
    return [];
  }

  const normalizedTags = Array.from(tags, (tag) => String(tag).trim()).filter(Boolean);
  for (const tag of normalizedTags) {
    if (!SUPPORTED_PRODUCT_TAGS.has(tag)) {
      errors.push(
        `Product tag "${tag}" is not wired in the function input query yet. Supported tags: ${[
          ...SUPPORTED_PRODUCT_TAGS,
        ].join(", ")}.`,
      );
    }
  }

  return normalizedTags;
}

function compileHideRatesCampaign(campaign, index, errors) {
  const path = `campaigns[${index}]`;
  const condition = assertMatch(campaign.condition ?? "all", ["all", "any"], `${path}.condition`, errors);
  const qualifiers = Array.isArray(campaign.qualifiers) ? campaign.qualifiers : [];
  if (qualifiers.length === 0) {
    errors.push(`${path}.qualifiers must contain at least one qualifier.`);
  }

  const action = compileRateSelector(campaign.rateSelector, `${path}.rateSelector`, errors);
  const base = {
    enabled: campaign.enabled !== false,
    description: String(campaign.name ?? ""),
    actions: [action],
  };

  if (condition === "any") {
    return qualifiers.map((qualifier, qualifierIndex) => ({
      ...base,
      id: `${slugify(campaign.name, `campaign-${index + 1}`)}-${qualifierIndex + 1}`,
      conditions: compileQualifier(qualifier, `${path}.qualifiers[${qualifierIndex}]`, errors),
    }));
  }

  const conditions = {};
  qualifiers.forEach((qualifier, qualifierIndex) => {
    Object.assign(conditions, compileQualifier(qualifier, `${path}.qualifiers[${qualifierIndex}]`, errors));
  });

  return [
    {
      ...base,
      id: slugify(campaign.name, `campaign-${index + 1}`),
      conditions,
    },
  ];
}

function compileShippingDiscountCampaign(campaign, index, errors) {
  const path = `campaigns[${index}]`;
  const condition = assertMatch(campaign.condition ?? "all", ["all", "any"], `${path}.condition`, errors);
  const qualifiers = Array.isArray(campaign.qualifiers) ? campaign.qualifiers : [];
  if (qualifiers.length === 0) {
    errors.push(`${path}.qualifiers must contain at least one qualifier.`);
  }

  const rateSelector = compileDeliveryTargetSelector(campaign.rateSelector, `${path}.rateSelector`, errors);
  const discount = compileDiscount(campaign.discount, `${path}.discount`, errors);
  const base = {
    enabled: campaign.enabled !== false,
    description: String(campaign.name ?? ""),
    rateSelector,
    discount,
  };

  if (condition === "any") {
    return qualifiers.map((qualifier, qualifierIndex) => ({
      ...base,
      id: `${slugify(campaign.name, `shipping-discount-${index + 1}`)}-${qualifierIndex + 1}`,
      conditions: compileQualifier(qualifier, `${path}.qualifiers[${qualifierIndex}]`, errors),
    }));
  }

  const conditions = {};
  qualifiers.forEach((qualifier, qualifierIndex) => {
    Object.assign(conditions, compileQualifier(qualifier, `${path}.qualifiers[${qualifierIndex}]`, errors));
  });

  return [
    {
      ...base,
      id: slugify(campaign.name, `shipping-discount-${index + 1}`),
      conditions,
    },
  ];
}

function compileCartValidationCampaign(campaign, index, errors) {
  const path = `campaigns[${index}]`;
  const condition = assertMatch(campaign.condition ?? "all", ["all", "any"], `${path}.condition`, errors);
  const qualifiers = Array.isArray(campaign.qualifiers) ? campaign.qualifiers : [];
  if (qualifiers.length === 0) {
    errors.push(`${path}.qualifiers must contain at least one qualifier.`);
  }

  const message = String(campaign.message ?? "").trim();
  if (!message) {
    errors.push(`${path}.message is required.`);
  }

  const messageTitle = String(campaign.message_title ?? campaign.messageTitle ?? "").trim();
  const base = {
    enabled: campaign.enabled !== false,
    description: String(campaign.name ?? ""),
    ...(messageTitle ? { messageTitle } : {}),
    message,
    target: String(campaign.target ?? "$.cart"),
  };

  if (condition === "any") {
    return qualifiers.map((qualifier, qualifierIndex) => ({
      ...base,
      id: `${slugify(campaign.name, `cart-validation-${index + 1}`)}-${qualifierIndex + 1}`,
      conditions: compileQualifier(qualifier, `${path}.qualifiers[${qualifierIndex}]`, errors),
    }));
  }

  const conditions = {};
  qualifiers.forEach((qualifier, qualifierIndex) => {
    Object.assign(conditions, compileQualifier(qualifier, `${path}.qualifiers[${qualifierIndex}]`, errors));
  });

  return [
    {
      ...base,
      id: slugify(campaign.name, `cart-validation-${index + 1}`),
      conditions,
    },
  ];
}

function compileCampaigns(campaigns, errors) {
  const rules = [];
  const shippingDiscounts = [];
  const validations = [];

  (campaigns ?? []).forEach((campaign, index) => {
    const path = `campaigns[${index}]`;
    if (!campaign || typeof campaign !== "object") {
      errors.push(`${path} must be a campaign.`);
      return;
    }

    if (campaign.type === "HideRates") {
      rules.push(...compileHideRatesCampaign(campaign, index, errors));
      return;
    }

    if (campaign.type === "ShippingDiscount") {
      shippingDiscounts.push(...compileShippingDiscountCampaign(campaign, index, errors));
      return;
    }

    if (campaign.type === "CartValidation") {
      validations.push(...compileCartValidationCampaign(campaign, index, errors));
      return;
    }

    errors.push(`${path} must be HideRates(...), ShippingDiscount(...), or CartValidation(...).`);
  });

  return { rules, shippingDiscounts, validations };
}

export function validateRulesConfig(config) {
  const errors = [];
  const allowedActions = new Set([
    "hideDeliveryOptionsWhereTitleIncludes",
    "hideDeliveryOptionsWhereTitleDoesNotInclude",
    "hideAllDeliveryOptions",
  ]);

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["Config must be a JSON object."];
  }

  if (config.version !== 1) {
    errors.push("version must be 1.");
  }

  if (!Array.isArray(config.rules)) {
    errors.push("rules must be an array.");
    return errors;
  }

  config.rules.forEach((rule, index) => {
    const prefix = `rules[${index}]`;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    if (!rule.id || typeof rule.id !== "string") errors.push(`${prefix}.id is required and must be a string.`);
    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") {
      errors.push(`${prefix}.enabled must be a boolean when provided.`);
    }
    if (!rule.conditions || typeof rule.conditions !== "object" || Array.isArray(rule.conditions)) {
      errors.push(`${prefix}.conditions must be an object.`);
    }

    if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
      errors.push(`${prefix}.actions must be a non-empty array.`);
    } else {
      rule.actions.forEach((action, actionIndex) => {
        const actionPrefix = `${prefix}.actions[${actionIndex}]`;
        if (!action || typeof action !== "object" || Array.isArray(action)) {
          errors.push(`${actionPrefix} must be an object.`);
          return;
        }
        if (!allowedActions.has(action.type)) errors.push(`${actionPrefix}.type is not supported.`);
        if (action.type !== "hideAllDeliveryOptions") {
          asStringArray(action.values, `${actionPrefix}.values`, errors);
        }
      });
    }
  });

  if (config.shippingDiscounts !== undefined && !Array.isArray(config.shippingDiscounts)) {
    errors.push("shippingDiscounts must be an array when provided.");
  }

  if (config.validations !== undefined && !Array.isArray(config.validations)) {
    errors.push("validations must be an array when provided.");
  }

  return errors;
}

export function compileRulesScript(source) {
  const context = createDslContext();
  const script = new vm.Script(`${source}\n;__hhGetResult();`, {
    filename: "hh-shipping-rules.js",
  });
  const result = script.runInContext(context, { timeout: 100 });
  const errors = [];

  validateSettings(result.settings, errors);

  if (!Array.isArray(result.campaigns)) {
    errors.push("The script must call campaigns([...]).");
  }

  const { rules, shippingDiscounts, validations } = compileCampaigns(result.campaigns, errors);
  const config = { version: 1, rules, shippingDiscounts, validations };
  errors.push(...validateRulesConfig(config));

  if (errors.length > 0) {
    const uniqueErrors = [...new Set(errors)];
    throw new Error(uniqueErrors.join("\n"));
  }

  return { config, json: prettyJson(config) };
}
