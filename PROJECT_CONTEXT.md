# HH Shipping Project Context

This file is for Codex continuity. Keep it short, factual, and updated when the architecture or debugging status changes.

## Project

- Repo: `https://github.com/coding-vasco/hh-shipping`
- Local path: `C:\Users\Convidado\Documents\Codex\2026-05-04\hh-shipping-poc`
- Branch: `main`
- Render URL: `https://hh-shipping.onrender.com`
- Render service ID: `srv-d7t5h5egvqtc73ab0u4g`
- Shopify organization: Hey Harper Trading
- Shopify app: `hh-shipping-poc`
- Test store: `grace-handmade-jewelry.myshopify.com`

## Architecture

The MVP centralizes shipping behavior in a Shopify app with a small JavaScript-like DSL edited in the embedded app.

- Checkout UI Extension: reads applied checkout discount codes and writes them into cart attributes, especially `_hh_discount_codes`. This is needed because Delivery Customization Function input does not expose `cart.discountCodes`.
- Checkout UI Extension also renders the NOMORERUST warning banner when the app block is placed near shipping methods and the cart has code `NOMORERUST` with subtotal `0`.
- Delivery Customization Function: reads `_hh_discount_codes`, cart data, delivery option title/handle, product tag booleans, and a delivery customization metafield config. It handles `HideRates` campaigns.
- Discount Function: reads `_hh_discount_codes`, cart data, delivery option title/handle, product tag booleans, and its automatic app discount metafield config. It handles `ShippingDiscount` campaigns.
- Cart and Checkout Validation Function: reads `_hh_discount_codes`, cart subtotal, product tag booleans, and its validation metafield config. It handles `CartValidation` campaigns such as NOMORERUST checkout blocking messages.
- Embedded app: stores the editable DSL in Prisma, compiles it to JSON, and publishes config to Shopify.

## DSL

Current phase supports:

- `settings({ productTags: [...] })`
- `campaigns([...])`
- `HideRates`
- `ShippingDiscount`
- `CartValidation`
- `CodeQualifier`
- `NoDiscountCodeQualifier`
- `CartSubtotalQualifier`
- `CartQuantityQualifier`
- `CartHasItemQualifier`
- `CountryCodeQualifier`
- `ProductTagSelector`
- `RateNameSelector`
- `AllRatesSelector`
- `PercentageDiscount`
- `FixedAmountDiscount`

Matching is intended to be case-insensitive. Rate matching checks both delivery option title and handle.

Product tags currently wired in function input queries:

- `box_shipping`
- `subs_box_mvp`
- `bf22_exc`

Adding more tags currently requires a code change in both function GraphQL input queries and rule evaluation mapping.

## Current Status

The DSL and compiled JSON match correctly. EU Script Editor campaign parity is confirmed in checkout testing.

The only checkout behavior proven to work earlier came from hardcoded delivery fallback rules. Those fallback rules were removed intentionally. Missing config now means "hide nothing", not "run old defaults".

The app now uses one primary action: `Save and publish`. Draft-only editing is deferred to v2.

The checkout status warnings are meaningful:

- "Shipping discount is not active": no automatic app discount exists for `HH shipping discounts POC`.
- "Delivery customization config is missing": the active delivery customization has no `function-configuration` metafield.
- "Checkout validation is not active": no active validation exists for `HH checkout validation POC`.

Latest Shopify state observed:

- Delivery customization exists and is enabled: `gid://shopify/DeliveryCustomization/45777164`, title `HH delivery customization POC`.
- Delivery customization metafield was missing.
- Discount function exists as an installed function, but no active automatic app discount titled `HH shipping discounts POC` existed.
- App scopes included `write_delivery_customizations` and `write_discounts`, so scopes were not the obvious blocker.

Most likely issue before the current fix: app web-component submit buttons did not reliably post `intent=publish`, causing the server action to save drafts without publishing to Shopify.

Shipping discount activation note: Shopify rejected `combinesWith.shippingDiscounts: true` for the automatic shipping app discount with the error "is not supported with these combines_with settings". Keep `orderDiscounts: true` and `productDiscounts: true`, but set `shippingDiscounts: false` for this POC so code/order discounts can combine with the app shipping discount without asking Shopify to combine it with other shipping discounts.

NOMORERUST v1 behavior:

- `HideRates` can hide all rates when code includes `NOMORERUST` and subtotal equals `0`.
- `CartValidation` can block checkout and show `NOMORERUST must be used with at least one paid jewelry item.` at `$.cart`.
- Shopify controls exact validation-message placement. The Checkout UI Extension shows the same message inline wherever the block is placed.

Store example DSL files:

- `docs/eu-shipping-rules-phase-1.dsl.js`
- `docs/uk-shipping-rules-phase-1.dsl.js`
- `docs/us-shipping-rules-phase-1.dsl.js`

## Useful Commands

Run from `C:\Users\Convidado\Documents\Codex\2026-05-04\hh-shipping-poc`.

```powershell
npm.cmd run build
npm.cmd run test:rules
cd .\extensions\hh-delivery-customization
npm.cmd test -- --run
cd ..\..\extensions\hh-shipping-discount
npm.cmd test -- --run
cd ..\..
shopify app deploy
```

Use `shopify app execute --query-file .\some-query.graphql --store grace-handmade-jewelry.myshopify.com` for Admin API queries. PowerShell quoting for inline GraphQL is fragile.

`shopify app execute` cannot run mutations on this non-dev store. Mutations must run through the embedded app/Admin API.

## Production Fork Checklist

1. Create/rename the production app and set the production app URL.
2. Configure production env vars on Render.
3. Deploy Shopify app extensions/config for the production app.
4. Install production app on EU, UK, and US stores.
5. In the embedded app, paste the correct store DSL and click `Save and publish`.
6. Query Shopify to confirm:
   - Delivery customization has metafield `$app:hh-delivery-customization/function-configuration`.
   - Automatic app discount `HH shipping discounts POC` exists and is active.
   - Checkout validation `HH checkout validation POC` exists and is active when the DSL includes validations.
7. Test checkout rules and discount combination settings.

## Hardening Decisions

- If `shippingDiscounts` compiles to an empty array, the app deactivates the existing `HH shipping discounts POC` automatic discount.
- If `validations` compiles to an empty array, the app disables the existing `HH checkout validation POC` validation.
- Delivery customization publishing is deterministic: it targets title `HH delivery customization POC` only and no longer falls back to the first enabled customization.
- Dynamic product tags are deferred. Adding tags in `settings({ productTags: [...] })` is not enough yet because Shopify Function input queries are static.
