# HH Shipping Project Context

This file is for Codex continuity. Keep it short, factual, and updated when the architecture or debugging status changes.

## Project

- Repo: `https://github.com/coding-vasco/hh-shipping`
- Local path: `C:\Users\Convidado\Documents\Codex\2026-05-04\hh-shipping-poc`
- Branch: `main`
- Dev Render URL: `https://hh-shipping.onrender.com`
- Dev Render service: `hh-shipping`, ID `srv-d7t5h5egvqtc73ab0u4g`
- Production Render URL: `https://hh-shipping-rules.onrender.com`
- Production Render service: `hh-shipping-rules`, ID `srv-d7trqs7avr4c73d10f30`
- Shopify organization: Hey Harper Trading
- Dev Shopify app: `hh-shipping-poc`
- Production Shopify app: `HH Shipping Rules`
- Test store: `grace-handmade-jewelry.myshopify.com`
- Production stores:
  - `hey-harper-shop-us.myshopify.com`
  - `hey-harper-shop-uk.myshopify.com`
  - `hey-harper-shop-nl.myshopify.com`

## Architecture

The MVP centralizes shipping behavior in a Shopify app with a small JavaScript-like DSL edited in the embedded app.

Production preparation:

- Keep `main` as the development branch/app tested on Grace.
- Use a separate `production` branch/app/Render service for the real stores.
- Production Shopify config lives in `shopify.app.production.toml` and should be filled with the production app Client ID before use.
- Prisma uses `DATABASE_URL`; dev can use `file:./dev.sqlite`, production should use a Render persistent disk path such as `file:/var/data/prod.sqlite`.
- Production safety guardrails live in `.github/pull_request_template.md`, `docs/runbooks/*`, and `docs/testing/manual-checkout-matrix.md`.
- Production DSL validation command: `npm run validate:production-rules`. It checks required store files, compilation, duplicate compiled IDs, golden snapshots, and checkout-risk warnings. Useful flags: `--store <shop.myshopify.com>`, `--json`, `--strict`, `--no-snapshots`.
- Golden snapshots for production DSL compiled output live in `tests/snapshots/production-rules`; update intentionally with `npm run snapshot:production`.
- Runtime golden tests live in `tests/production-runtime-golden.test.mjs`; they compile the production DSL files and assert representative real Function outputs for Delivery Customization, Shipping Discount, Checkout Validation, Control Room pause behavior, and fail-open behavior.
- GitHub Actions runs `npm run test:checkout-safety` on pushes/PRs for `main` and `production`. The user currently prefers keeping Render auto-deploy enabled rather than blocking deploys on CI. After each Codex code change/deploy, explicitly tell the user whether the checkout safety gate was run and whether there are any red flags.
- Function-local fail-open tests cover malformed config, missing delivery groups, missing validation messages, and missing metafields. Production behavior should remain fail-open: do not hide rates, do not apply discounts, and do not block checkout when runtime inputs are uncertain.

- Checkout UI Extension: reads applied checkout discount codes and writes them into cart attributes, especially `_hh_discount_codes`. This is needed because Delivery Customization Function input does not expose `cart.discountCodes`.
- Checkout UI Extension also renders the NOMORERUST warning banner when the app block is placed near shipping methods and the cart has code `NOMORERUST` with subtotal `0`.
- The inline Checkout UI warning reads the published DSL config from app-owned shop metafield `$app:hh-checkout-ui/function-configuration`; `CartValidation.message_title` controls the banner heading and `CartValidation.message` controls the banner body.
- Delivery Customization Function: reads `_hh_discount_codes`, cart data, delivery option title/handle, product tag booleans, and a delivery customization metafield config. It handles `HideRates` campaigns.
- Discount Function: reads `_hh_discount_codes`, cart data, delivery option title/handle, product tag booleans, and its automatic app discount metafield config. It handles `ShippingDiscount` campaigns.
- Cart and Checkout Validation Function: reads `_hh_discount_codes`, cart subtotal, product tag booleans, and its validation metafield config. It handles `CartValidation` campaigns such as NOMORERUST checkout blocking messages.
- Embedded app: stores the editable working DSL in Prisma, stores up to 10 named DSL drafts in Shopify app-owned shop metafields, compiles DSL to JSON, and publishes config to Shopify.
- Control Room: separate embedded app tab at `/app/control-room`. It stores checkout impact controls in shop metafield `$app:hh-control-room/control-config`. Missing/malformed control config defaults to all controls enabled for easy testing after app updates.
- All three Functions read Control Room config. It can globally pause app impact, pause HideRates, pause ShippingDiscounts, pause CartValidations, or pause discount-code-dependent rules without changing the campaign DSL.

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

Product tags are dynamically declared in `settings({ productTags: [...] })`.
On publish, the app writes those tags to `$app:hh-function-input/input-variables`
on each Function owner. The Function input queries call `product.hasTags(tags:
$productTags)`, so ops can add campaign tags in DSL settings without a code
change. The compiler rejects a `ProductTagSelector` tag that is not declared in
`settings.productTags`. Shopify caps Function input variable arrays at 100 values.

## Current Status

As of 2026-05-09: production is frozen for the weekend. The user will return to production rollout with the team during the week. Continue new development on `main` / Grace only unless explicitly told otherwise.

The DSL and compiled JSON match correctly. EU Script Editor campaign parity is confirmed in checkout testing. UK production app install/publish was tested enough for confidence; remaining UK rollout decisions are paused/frozen by the user.

The only checkout behavior proven to work earlier came from hardcoded delivery fallback rules. Those fallback rules were removed intentionally. Missing config now means "hide nothing", not "run old defaults".

The app now separates draft storage from checkout publishing. Drafts are saved in Shopify app-owned metafield `$app:hh-shipping-admin/dsl-drafts` and do not change checkout behavior until a user reviews and publishes rules.

Grace state:

- Grace intentionally has the empty default DSL published.
- Empty DSL compiles to no hide rules, no shipping discounts, and no validations.
- Use Grace for Phase F and later dev/testing.

Production state:

- Production branch/service has the first-install bootstrap fix: `Save and publish` creates the Delivery Customization if missing.
- Production install still requires adding the `HH Shipping Rules` checkout app block in Checkout Editor and publishing store-specific DSL inside each store.
- US/EU installs should be ready for the same flow when the user resumes production work.

Completed phases:

- Phase A: production safety docs/checklists.
- Phase B: production DSL validation command.
- Phase C: compiled + runtime golden tests.
- Phase D: fail-open runtime hardening/tests.
- Phase E: admin UI safety improvements on `main` / Grace.
- Phase F: lightweight admin publish safety UX on `main` / Grace.
- Phase G: dynamic product tag strategy implemented on `main` / Grace.

Phase F UX behavior:

- Editing DSL now makes the rules "not reviewed".
- `Review changes` compiles and saves the DSL, refreshes the campaign summary and publish impact, but does not publish to checkout.
- `Publish reviewed rules` is disabled while there are unreviewed local edits.
- `Save draft`, `Load`, and `Delete` manage up to 10 named DSL drafts for the current shop. These drafts survive app deploys because they live in Shopify metafields, not Render memory.
- `Unpublish campaigns` keeps the visible DSL in the editor but publishes empty fail-open checkout config.
- The publish impact panel stays compact; it shows counts and only the most important notes for reviewed configs.
- Kill switches are intentionally deferred until a later phase.

The checkout status warnings are meaningful:

- "Shipping discount is not active": no automatic app discount exists for `HH shipping discounts POC`.
- "Delivery customization config is missing": the active delivery customization has no `function-configuration` metafield.
- "Checkout validation is not active": no active validation exists for `HH checkout validation POC`.

Important setup behavior:

- `Save and publish` creates/updates the automatic app shipping discount with the compiled config, including an empty `shippingDiscounts` array when no shipping discounts are active.
- The app does not intentionally set `startsAt` or `endsAt` on the automatic app shipping discount. This avoids update failures caused by expired automatic discounts.
- `Save and publish` creates/updates checkout validation when `validations` is non-empty.
- `Save and publish` creates the delivery customization when missing, then writes `$app:hh-delivery-customization/function-configuration`.
- The checkout app block must be placed near shipping methods so Checkout UI Extension discount-code sync and NOMORERUST inline warning can run.

Shipping discount activation note: Shopify rejected `combinesWith.shippingDiscounts: true` for the automatic shipping app discount with the error "is not supported with these combines_with settings". Keep `orderDiscounts: true` and `productDiscounts: true`, but set `shippingDiscounts: false` for this POC so code/order discounts can combine with the app shipping discount without asking Shopify to combine it with other shipping discounts.

NOMORERUST v1 behavior:

- `HideRates` can hide all rates when code includes `NOMORERUST` and subtotal equals `0`.
- `CartValidation` can block checkout and show `NOMORERUST must be used with at least one paid jewelry item.` at `$.cart`; its `message_title` is used by the inline app-block banner near shipping methods.
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
npm.cmd run test:checkout-runtime
npm.cmd run test:checkout-safety
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

- If `shippingDiscounts` compiles to an empty array, the app keeps the existing `HH shipping discounts POC` automatic discount object but writes an empty config so it has no checkout effect.
- If `validations` compiles to an empty array, the app disables the existing `HH checkout validation POC` validation.
- Delivery customization publishing is deterministic: it targets title `HH delivery customization POC` only and no longer falls back to the first enabled customization.
- Dynamic product tags are supported through Shopify Function input-query variables. Add campaign tags to `settings({ productTags: [...] })` before referencing them in `ProductTagSelector`.
