# HH Shipping Rules Architecture

HH Shipping Rules is an internal Shopify app that replaces Shopify Scripts shipping behavior for Hey Harper stores.

The app is production-critical because it affects checkout delivery options, shipping discounts, and checkout blocking messages. Productization work must not endanger the internal production app.

## Deployment Tracks

| Track | Branch | Shopify app | Render service | Store |
| --- | --- | --- | --- | --- |
| Development | `main` | `hh-shipping-poc` | `hh-shipping` | Grace test store |
| Production | `production` | `HH Shipping Rules` | `hh-shipping-rules` | US, UK, NL stores |

Development work is tested on Grace first. Production changes require an intentional merge or cherry-pick into `production`, a production Render deploy, and a production Shopify app deploy.

## Runtime Pieces

The Checkout UI Extension reads currently applied checkout discount codes and writes them to the `_hh_discount_codes` cart attribute. This is necessary because Delivery Customization Functions do not expose `cart.discountCodes`.

The Delivery Customization Function reads cart attributes, product tag booleans, delivery option title/handle, and the published delivery config. It handles `HideRates` campaigns.

The Shipping Discount Function reads the same campaign context and the published discount config. It handles `ShippingDiscount` campaigns.

The Cart and Checkout Validation Function reads the published validation config. It handles `CartValidation` campaigns such as NOMORERUST.

The embedded admin app stores the editable DSL per shop in Prisma, compiles it, and publishes compiled JSON to Shopify metafields.

## Data Flow

1. Ops edits DSL in the embedded app.
2. Ops clicks `Save and publish`.
3. The app compiles DSL to JSON.
4. The app publishes JSON to the relevant Function owner metafields and checkout UI config metafield.
5. Shopify checkout executes Functions using the published config.

## Fail-Open Principle

When config is missing, malformed, or uncertain, checkout should remain open:

- Do not hide rates.
- Do not apply broad discounts.
- Do not block checkout.

Any change that weakens this principle is high risk.

## Dynamic Product Tags

Product tags are declared in the DSL:

```js
settings({
  productTags: ["box_shipping", "subs_box_mvp", "bf22_exc"],
});
```

On publish, the app writes those tags to the Shopify Function owner metafield
`$app:hh-function-input/input-variables` as:

```json
{ "productTags": ["box_shipping", "subs_box_mvp", "bf22_exc"] }
```

The three Shopify Functions use that metafield as input-query variables and call
`product.hasTags(tags: $productTags)`. A campaign can reference any product tag
listed in `settings.productTags`. The compiler rejects product tag references that
are not declared in settings. Shopify Function input variables support up to 100
values, so keep this list focused on campaign-relevant tags.
