# HH Shipping Rules DSL

This app uses a small JavaScript-like DSL to define shipping campaigns. The DSL is not general JavaScript for business logic. It is a readable way to write campaigns that the app compiles into the JSON consumed by the Shopify Delivery Customization Function.

Ops can edit this script in the Shopify app, use the compiled JSON preview to sanity-check the generated rules, then publish to checkout.

## Mental Model

Every campaign has three parts:

1. Campaign type: what kind of campaign this is.
2. Qualifiers: when the campaign applies.
3. Rate selector: which delivery options are affected.

Phase 1 supports one campaign type:

```js
HideRates({ ... })
```

`HideRates` hides matching delivery options when its qualifiers match the cart.

## File Shape

Every script should follow this shape:

```js
settings({
  productTags: ["box_shipping", "subs_box_mvp", "bf22_exc"],
});

campaigns([
  HideRates({
    name: "Campaign name",
    condition: "all",
    qualifiers: [
      // Qualifiers go here.
    ],
    rateSelector: RateNameSelector({ match: "include", names: ["eco"] }),
  }),
]);
```

Comments are allowed with `//`.

## Campaign Conditions

Use `condition: "all"` when every qualifier must match.

```js
condition: "all"
```

Use `condition: "any"` when any one qualifier can match. Internally, the compiler expands this into separate rules.

```js
condition: "any"
```

## Supported Qualifiers

### Discount Code Contains Text

Case-insensitive. A code like `HHCSF272933_2` matches `HHCSF`.

```js
CodeQualifier({ match: "include", codes: ["HHCSF"] })
```

### Discount Code Does Not Contain Text

```js
CodeQualifier({ match: "does_not_include", codes: ["VIP50", "GOLDJOY"] })
```

### No Discount Code

```js
NoDiscountCodeQualifier()
```

### Cart Subtotal

Uses store currency.

```js
CartSubtotalQualifier({ comparison: "less_than", amount: 10 })
CartSubtotalQualifier({ comparison: "greater_than", amount: 50 })
```

### Total Cart Quantity

```js
CartQuantityQualifier({ comparison: "greater_than", amount: 5 })
CartQuantityQualifier({ comparison: "less_than_or_equal", amount: 5 })
```

### Cart Has Product Tag

Phase 1 currently supports product tag presence only: amount must be `1` and comparison must be `"greater_than_or_equal"`.

The tag must also be declared in `settings({ productTags: [...] })`.

```js
CartHasItemQualifier({
  comparison: "greater_than_or_equal",
  amount: 1,
  selector: ProductTagSelector({ match: "match", tags: ["box_shipping"] }),
})
```

Negated tag check:

```js
CartHasItemQualifier({
  comparison: "greater_than_or_equal",
  amount: 1,
  selector: ProductTagSelector({ match: "does_not_match", tags: ["box_shipping"] }),
})
```

Important: the Delivery Customization Function must query each product tag explicitly. Phase 1 currently wires:

```txt
box_shipping
subs_box_mvp
bf22_exc
```

Adding a new tag is a developer task until we add dynamic tag support.

### Shipping Country

```js
CountryCodeQualifier({ match: "one_of", countryCodes: ["PT", "ES", "FR"] })
```

## Supported Rate Selectors

Rate matching checks both delivery option title and handle, case-insensitively.

### Hide Rates Whose Name Contains Text

```js
RateNameSelector({ match: "include", names: ["eco"] })
```

### Hide Rates Whose Name Does Not Contain Text

```js
RateNameSelector({ match: "does_not_include", names: ["subscription"] })
```

### Hide All Rates

```js
AllRatesSelector()
```

Use this carefully. It should generally be paired with a clear checkout message in a later validation phase.

## Working Examples

### HHCSF Hides Eco

```js
HideRates({
  name: "HHCSF hides eco",
  condition: "all",
  qualifiers: [
    CodeQualifier({ match: "include", codes: ["HHCSF"] }),
  ],
  rateSelector: RateNameSelector({ match: "include", names: ["eco"] }),
})
```

### VIP/GOLDJOY Subscription Only

```js
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
})
```

### Normal Carts Hide Subscription

```js
HideRates({
  name: "Normal carts hide subscription",
  condition: "any",
  qualifiers: [
    NoDiscountCodeQualifier(),
    CodeQualifier({ match: "does_not_include", codes: ["VIP50", "GOLDJOY"] }),
  ],
  rateSelector: RateNameSelector({ match: "include", names: ["subscription"] }),
})
```

### NOMORERUST Minimum Subtotal

```js
HideRates({
  name: "NOMORERUST minimum paid item",
  condition: "all",
  qualifiers: [
    CodeQualifier({ match: "include", codes: ["NOMORERUST"] }),
    CartSubtotalQualifier({ comparison: "less_than", amount: 10 }),
  ],
  rateSelector: AllRatesSelector(),
})
```

Later, this should be paired with a Cart and Checkout Validation Function so checkout can show a message such as:

```txt
NOMORERUST must be used with at least one paid jewelry item.
```

## How To Ask An LLM For Help

Use a prompt like this:

```txt
I am editing HH Shipping Rules DSL. Do not use arbitrary JavaScript, loops, variables, or custom functions. Only use settings(), campaigns(), HideRates(), CodeQualifier(), NoDiscountCodeQualifier(), CartSubtotalQualifier(), CartQuantityQualifier(), CartHasItemQualifier(), ProductTagSelector(), CountryCodeQualifier(), RateNameSelector(), and AllRatesSelector().

Create a campaign that [describe the business rule]. Use condition "all" when every qualifier must match and "any" when any qualifier can match. Match discount codes and rate names case-insensitively by text inclusion.
```

Always paste the result into the app and use Save draft before Publish to checkout.
