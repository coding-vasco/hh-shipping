# HH Shipping Project Brief

Use this as the seed context for a ChatGPT/Codex project named **HH shipping**.

## Mission

Build and harden an internal Shopify app that replaces Hey Harper's Shopify Scripts shipping behavior across three Shopify Plus production stores while keeping development isolated on the Grace test store.

The app must let ops edit a readable JavaScript-like DSL inside Shopify admin and publish shipping campaigns without changing repo code.

## Repos And Environments

- GitHub repo: `https://github.com/coding-vasco/hh-shipping`
- Local repo: `C:\Users\Convidado\Documents\Codex\2026-05-04\hh-shipping-poc`
- Dev branch: `main`
- Production branch: `production`
- Dev app/store: `hh-shipping-poc` on `grace-handmade-jewelry.myshopify.com`
- Dev Render: `https://hh-shipping.onrender.com`, service `srv-d7t5h5egvqtc73ab0u4g`
- Production app: `HH Shipping Rules`
- Production Render: `https://hh-shipping-rules.onrender.com`, service `srv-d7trqs7avr4c73d10f30`
- Production stores:
  - `hey-harper-shop-uk.myshopify.com`
  - `hey-harper-shop-us.myshopify.com`
  - `hey-harper-shop-nl.myshopify.com`

## Current Operating State

As of 2026-05-09, production rollout is frozen for the weekend. Continue development only on `main` / Grace unless explicitly told otherwise.

Grace intentionally has the empty default DSL published. This means checkout should fail open: no hidden rates, no shipping discounts, and no validation blocks.

Production has the bootstrap fix that creates Delivery Customization on first `Save and publish`, but production work should pause until the user resumes with the team.

## App Architecture

The app has four checkout-facing pieces:

- Checkout UI Extension: syncs checkout discount codes into `_hh_discount_codes`, and shows inline NOMORERUST warning text from published DSL config.
- Delivery Customization Function: reads published config and hides delivery options for `HideRates` campaigns.
- Shipping Discount Function: reads published config and creates delivery discount candidates for `ShippingDiscount` campaigns.
- Cart and Checkout Validation Function: reads published config and blocks checkout/cart for `CartValidation` campaigns.

The embedded admin app stores the DSL in Prisma, compiles it to JSON, and publishes config to Shopify metafields and app discount/validation resources.

## DSL Vocabulary

Supported campaign types:

- `HideRates`
- `ShippingDiscount`
- `CartValidation`

Supported qualifiers/selectors:

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

Product tags currently wired into Function input queries:

- `box_shipping`
- `subs_box_mvp`
- `bf22_exc`

Adding product tags is still a developer task because Shopify Function input queries are static.

## Safety Principles

- Production should fail open when config is missing, malformed, or uncertain.
- Missing/empty config must not hide rates, apply discounts, or block checkout.
- Discount-code-based rules depend on the Checkout UI Extension writing `_hh_discount_codes`.
- The checkout app block must be added in Checkout Editor near shipping methods.
- Production DSL changes should be versioned in Git when preparing official rollouts, even though ops can publish DSL through the app.

## Useful Commands

Run from repo root:

```powershell
npm.cmd run build
npm.cmd run test:rules
npm.cmd run validate:production-rules
npm.cmd exec -- shopify app build
```

Function-local tests:

```powershell
cd .\extensions\hh-delivery-customization
npm.cmd test -- --run
cd ..\..\extensions\hh-shipping-discount
npm.cmd test -- --run
cd ..\..\extensions\hh-checkout-validation
npm.cmd test -- --run
```

## Completed Phases

- Phase A: production safety docs/checklists.
- Phase B: production DSL validation command.
- Phase C: compiled + runtime golden tests.
- Phase D: fail-open runtime hardening/tests.
- Phase E: admin UI safety improvements on Grace/dev.

## Next

Phase F should happen on `main` / Grace. Confirm scope before coding.

Do not change or deploy the `production` branch while production is frozen unless the user explicitly restarts rollout work.
