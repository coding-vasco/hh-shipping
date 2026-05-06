// HH shipping rules Phase 1 - US store
settings({
  productTags: ["box_shipping", "subs_box_mvp", "bf22_exc"],
});

campaigns([
  HideRates({
    name: "VIP50/GOLDJOY subscription only",
    condition: "all",
    qualifiers: [
      CodeQualifier({ match: "include", codes: ["VIP50", "GOLDJOY"] }),
    ],
    rateSelector: RateNameSelector({ match: "does_not_include", names: ["subscription"] }),
  }),

  HideRates({
    name: "Normal carts hide subscription",
    condition: "any",
    qualifiers: [
      CodeQualifier({ match: "does_not_include", codes: ["VIP50", "GOLDJOY"] }),
      NoDiscountCodeQualifier(),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["subscription"] }),
  }),

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

  ShippingDiscount({
    name: "Free standard shipping by code",
    condition: "all",
    qualifiers: [
      CodeQualifier({
        match: "include",
        codes: [
          "INFL1PREMIUM",
          "INFL2PREMIUM",
          "INFL3PREMIUM",
          "HHCSD",
          "HHCSF",
          "FREESETPC",
          "HEYHARPERINTERVIEW",
          "HHCSTEST",
          "VIP50",
        ],
      }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Standard"] }),
    discount: PercentageDiscount({ percent: 100, message: "Free Shipping" }),
  }),

  ShippingDiscount({
    name: "Free priority for 5 qualifying items",
    condition: "all",
    qualifiers: [
      CartHasItemQualifier({
        comparison: "greater_than_or_equal",
        amount: 5,
        selector: ProductTagSelector({ match: "does_not_match", tags: ["bf22_exc"] }),
      }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Priority", "Prioritaire"] }),
    discount: PercentageDiscount({ percent: 100, message: "Free Priority Handling (3+ Items)" }),
  }),

  ShippingDiscount({
    name: "HHINFEMMA free express",
    condition: "all",
    qualifiers: [
      CodeQualifier({ match: "include", codes: ["HHINFEMMA"] }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Express"] }),
    discount: PercentageDiscount({ percent: 100, message: "Free Express Shipping" }),
  }),

  ShippingDiscount({
    name: "Influencer free priority",
    condition: "all",
    qualifiers: [
      CodeQualifier({
        match: "include",
        codes: [
          "AMALIESUMMER23",
          "EVASUMMER23",
          "LAINEYSUMMER23",
          "CADSUMMER23",
          "DEARSJANA",
          "HEYSJANA",
          "HEYEVAMELOCHE",
          "HEYAMALIE",
          "KNOWMEBETTER",
        ],
      }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Priority", "Prioritaire"] }),
    discount: PercentageDiscount({ percent: 100, message: "Free Priority Handling" }),
  }),

  HideRates({
    name: "NOMORERUST hides all shipping at zero subtotal",
    condition: "all",
    qualifiers: [
      CodeQualifier({ match: "include", codes: ["NOMORERUST"] }),
      CartSubtotalQualifier({ comparison: "equal_to", amount: 0 }),
    ],
    rateSelector: AllRatesSelector(),
  }),

  CartValidation({
    name: "NOMORERUST requires paid jewelry",
    condition: "all",
    qualifiers: [
      CodeQualifier({ match: "include", codes: ["NOMORERUST"] }),
      CartSubtotalQualifier({ comparison: "equal_to", amount: 0 }),
    ],
    message_title: "Discount code requires a paid item",
    message: "NOMORERUST must be used with at least one paid jewelry item.",
    target: "$.cart",
  }),
]);
