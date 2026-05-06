import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useMemo} from "preact/hooks";
import {
  useApplyAttributeChange,
  useAppMetafields,
  useAttributeValues,
  useCartLines,
  useDiscountCodes,
  useSubtotalAmount,
} from "@shopify/ui-extensions/checkout/preact";

const SHIPPING_CAMPAIGN_ATTRIBUTE = "_hh_shipping_campaign";
const HIDE_ECO_ATTRIBUTE = "_hh_hide_eco";
const DISCOUNT_CODES_ATTRIBUTE = "_hh_discount_codes";
const CHECKOUT_UI_NAMESPACE = "$app:hh-checkout-ui";
const CONFIG_KEY = "function-configuration";

export default async () => {
  render(<Extension />, document.body);
};

function parseRulesConfig(appMetafields) {
  const entry = appMetafields.find(
    ({metafield}) =>
      metafield.namespace === CHECKOUT_UI_NAMESPACE &&
      metafield.key === CONFIG_KEY,
  );

  if (!entry?.metafield?.value) return null;

  try {
    return JSON.parse(entry.metafield.value);
  } catch (error) {
    console.warn("Could not parse HH checkout UI config.", error);
    return null;
  }
}

function compareNumber(actual, comparison, expected) {
  switch (comparison) {
    case "greater_than":
      return actual > expected;
    case "greater_than_or_equal":
      return actual >= expected;
    case "less_than":
      return actual < expected;
    case "less_than_or_equal":
      return actual <= expected;
    case "equal_to":
      return actual === expected;
    default:
      return false;
  }
}

function codeMatches(codes, expectedCodes, mode) {
  const normalizedExpected = expectedCodes.map((code) => code.toUpperCase());
  const hasMatch = codes.some((code) =>
    normalizedExpected.some((expectedCode) => code.includes(expectedCode)),
  );

  return mode === "include" ? hasMatch : !hasMatch;
}

function validationMatches(rule, {codes, subtotal, quantity}) {
  if (!rule?.enabled || !rule.conditions) return false;

  const conditions = rule.conditions;

  if (conditions.noDiscountCode && codes.length > 0) return false;

  if (
    Array.isArray(conditions.discountCodeIncludes) &&
    !codeMatches(codes, conditions.discountCodeIncludes, "include")
  ) {
    return false;
  }

  if (
    Array.isArray(conditions.discountCodeDoesNotInclude) &&
    !codeMatches(codes, conditions.discountCodeDoesNotInclude, "does_not_include")
  ) {
    return false;
  }

  if (
    conditions.subtotal &&
    !compareNumber(
      subtotal,
      conditions.subtotal.comparison,
      Number(conditions.subtotal.amount),
    )
  ) {
    return false;
  }

  if (
    conditions.cartTotalQuantity &&
    !compareNumber(
      quantity,
      conditions.cartTotalQuantity.comparison,
      Number(conditions.cartTotalQuantity.amount),
    )
  ) {
    return false;
  }

  return true;
}

function Extension() {
  const discountCodes = useDiscountCodes();
  const lines = useCartLines();
  const subtotalAmount = useSubtotalAmount();
  const applyAttributeChange = useApplyAttributeChange();
  const appMetafields = useAppMetafields({
    namespace: CHECKOUT_UI_NAMESPACE,
    key: CONFIG_KEY,
  });

  const [currentCampaign, currentHideEco, currentDiscountCodes] = useAttributeValues([
    SHIPPING_CAMPAIGN_ATTRIBUTE,
    HIDE_ECO_ATTRIBUTE,
    DISCOUNT_CODES_ATTRIBUTE,
  ]);

  const nextAttributes = useMemo(() => {
    const codes = discountCodes.map((discountCode) =>
      discountCode.code.toUpperCase(),
    );

    const subscriptionOnly = codes.some(
      (code) => code.includes("VIP50") || code.includes("GOLDJOY"),
    );

    const hideEco = codes.some((code) => code.includes("HHCSF"));

    return {
      codes,
      campaign: subscriptionOnly ? "subscription_only" : "normal",
      hideEco: hideEco ? "true" : "false",
    };
  }, [discountCodes]);

  useEffect(() => {
    async function syncAttributes() {
      if (!shopify.instructions.value.attributes.canUpdateAttributes) {
        console.warn("Cart attribute updates are not available in this checkout.");
        return;
      }

      if (currentCampaign !== nextAttributes.campaign) {
        await applyAttributeChange({
          type: "updateAttribute",
          key: SHIPPING_CAMPAIGN_ATTRIBUTE,
          value: nextAttributes.campaign,
        });
      }

      if (currentHideEco !== nextAttributes.hideEco) {
        await applyAttributeChange({
          type: "updateAttribute",
          key: HIDE_ECO_ATTRIBUTE,
          value: nextAttributes.hideEco,
        });
      }

      const nextDiscountCodes = JSON.stringify(nextAttributes.codes);
      if (currentDiscountCodes !== nextDiscountCodes) {
        await applyAttributeChange({
          type: "updateAttribute",
          key: DISCOUNT_CODES_ATTRIBUTE,
          value: nextDiscountCodes,
        });
      }
    }

    syncAttributes();
  }, [
    applyAttributeChange,
    currentCampaign,
    currentDiscountCodes,
    currentHideEco,
    nextAttributes.campaign,
    nextAttributes.codes,
    nextAttributes.hideEco,
  ]);

  const bannerRule = useMemo(() => {
    const config = parseRulesConfig(appMetafields);
    const subtotal = Number(subtotalAmount?.amount ?? 0);
    const quantity = lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
    const matchingRule = config?.validations?.find((rule) =>
      validationMatches(rule, {
        codes: nextAttributes.codes,
        quantity,
        subtotal,
      }),
    );

    if (matchingRule) return matchingRule;

    const showNoMoreRustFallback =
      subtotal === 0 &&
      nextAttributes.codes.some((code) => code.includes("NOMORERUST"));

    if (!showNoMoreRustFallback) return null;

    return {
      messageTitle: "Discount code requires a paid item",
      message: "NOMORERUST must be used with at least one paid jewelry item.",
    };
  }, [appMetafields, lines, nextAttributes.codes, subtotalAmount?.amount]);

  if (!bannerRule) return null;

  return (
    <s-banner
      tone="critical"
      heading={bannerRule.messageTitle ?? bannerRule.description ?? "Checkout issue"}
    >
      {bannerRule.message}
    </s-banner>
  );
}
