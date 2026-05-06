// HH shipping rules Phase 1 - EU store
// Product tags must also be wired in the Delivery Customization Function and Shipping Discount Function input queries.
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

  ShippingDiscount({
    name: "Free priority by code or quantity",
    condition: "any",
    qualifiers: [
      CodeQualifier({
        match: "include",
        codes: [
          "DEAR",
          "HHXGYMSHARK",
          "HHXPVOLVE",
          "ANNASTRUP",
          "MADIE",
          "RDY2MINGLE",
          "HEYSJANA",
          "HEYAMALIE",
          "HEYEVAMELOCHE",
          "KNOWMEBETTER",
          "SPINWIN_FS",
        ],
      }),
      CartHasItemQualifier({
        comparison: "greater_than_or_equal",
        amount: 5,
        selector: ProductTagSelector({ match: "does_not_match", tags: ["bf22_exc"] }),
      }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Priority", "Prioritaire"] }),
    discount: PercentageDiscount({ percent: 100, message: "Free Priority Shipping" }),
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
          "HHCSTEST",
          "HEYHARPERINTERVIEW",
          "HHINF",
          "VIP50",
          "PIECE",
        ],
      }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Standard"] }),
    discount: PercentageDiscount({ percent: 100, message: "Free Shipping" }),
  }),

  HideRates({
    name: "Box shipping hides eco",
    condition: "all",
    qualifiers: [
      CartHasItemQualifier({
        comparison: "greater_than_or_equal",
        amount: 1,
        selector: ProductTagSelector({ match: "match", tags: ["box_shipping"] }),
      }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Eco"] }),
  }),

  ShippingDiscount({
    name: "Box shipping free standard over 16",
    condition: "all",
    qualifiers: [
      CartHasItemQualifier({
        comparison: "greater_than_or_equal",
        amount: 1,
        selector: ProductTagSelector({ match: "match", tags: ["box_shipping"] }),
      }),
      CartSubtotalQualifier({ comparison: "greater_than", amount: 16 }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["standard"] }),
    discount: PercentageDiscount({ percent: 100, message: "Free Shipping" }),
  }),

  HideRates({
    name: "HHCSF hides eco",
    condition: "all",
    qualifiers: [
      CodeQualifier({ match: "include", codes: ["HHCSF"] }),
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["Eco"] }),
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
