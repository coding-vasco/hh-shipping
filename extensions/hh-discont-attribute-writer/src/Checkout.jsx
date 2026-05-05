import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useMemo} from "preact/hooks";
import {
  useApplyAttributeChange,
  useAttributeValues,
  useDiscountCodes,
} from "@shopify/ui-extensions/checkout/preact";

const SHIPPING_CAMPAIGN_ATTRIBUTE = "_hh_shipping_campaign";
const HIDE_ECO_ATTRIBUTE = "_hh_hide_eco";
const DISCOUNT_CODES_ATTRIBUTE = "_hh_discount_codes";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const discountCodes = useDiscountCodes();
  const applyAttributeChange = useApplyAttributeChange();

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

  return null;
}
