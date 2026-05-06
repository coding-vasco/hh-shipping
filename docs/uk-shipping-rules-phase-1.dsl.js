// HH shipping rules Phase 1 - UK store
settings({
  productTags: ["box_shipping", "subs_box_mvp", "bf22_exc"],
});

campaigns([
  HideRates({
    name: "Hide letterbox for box shipping or large carts",
    condition: "any",
    qualifiers: [
      CartHasItemQualifier({
        comparison: "greater_than_or_equal",
        amount: 1,
        selector: ProductTagSelector({ match: "match", tags: ["box_shipping"] }),
      }),
      CartQuantityQualifier({ comparison: "greater_than", amount: 5 }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Letterbox Delivery"] }),
  }),

  HideRates({
    name: "Hide Standard UK for non-box small carts",
    condition: "all",
    qualifiers: [
      CartHasItemQualifier({
        comparison: "equal_to",
        amount: 0,
        selector: ProductTagSelector({ match: "match", tags: ["box_shipping"] }),
      }),
      CartQuantityQualifier({ comparison: "less_than_or_equal", amount: 5 }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Standard UK"] }),
  }),

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
    name: "Free standard or letterbox by code",
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
          "PIECE",
        ],
      }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Standard", "Letterbox"] }),
    discount: PercentageDiscount({ percent: 100, message: "Free Shipping" }),
  }),

  ShippingDiscount({
    name: "Free priority for 3 qualifying items",
    condition: "all",
    qualifiers: [
      CartHasItemQualifier({
        comparison: "greater_than_or_equal",
        amount: 3,
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

  ShippingDiscount({
    name: "BFDEAL4 free express with 4 items",
    condition: "all",
    qualifiers: [
      CodeQualifier({ match: "include", codes: ["BFDEAL4"] }),
      CartQuantityQualifier({ comparison: "greater_than_or_equal", amount: 4 }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["express"] }),
    discount: PercentageDiscount({ percent: 100, message: "BFDEAL4 - Free Express Shipping" }),
  }),

  ShippingDiscount({
    name: "BFDEAL4 free priority",
    condition: "all",
    qualifiers: [
      CodeQualifier({ match: "include", codes: ["BFDEAL4"] }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["priority"] }),
    discount: PercentageDiscount({ percent: 100, message: "BFDEAL 4 - Free Priority Shipping" }),
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
