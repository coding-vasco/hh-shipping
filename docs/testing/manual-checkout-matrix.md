# Manual Checkout Test Matrix

Run this before disabling Script Editor on any production store, and after any high-risk checkout behavior change.

## Per Store

- `hey-harper-shop-us.myshopify.com`
- `hey-harper-shop-uk.myshopify.com`
- `hey-harper-shop-nl.myshopify.com`

## Required Checks

| Scenario | Expected result | Pass |
| --- | --- | --- |
| No discount code | Normal rates visible; subscription rates hidden when configured |  |
| VIP50 | Non-subscription rates hidden; subscription rate visible |  |
| GOLDJOY | Non-subscription rates hidden; subscription rate visible |  |
| HHCSF | Eco rates hidden where configured |  |
| Free standard shipping code | Matching standard rate discounted only |  |
| Priority shipping campaign | Matching priority rate discounted only |  |
| Product tag `subs_box_mvp` | Subscription free standard campaign works |  |
| Product tag `box_shipping` | Box-shipping hide/discount behavior works |  |
| Product tag `bf22_exc` exclusion | Quantity campaigns exclude configured products |  |
| NOMORERUST with subtotal 0 | Shipping hidden, validation blocks checkout, banner appears |  |
| NOMORERUST with paid item | Checkout proceeds and shipping behaves normally |  |
| Remove discount code | `_hh_discount_codes` clears and behavior returns to normal |  |
| Refresh checkout | Behavior persists correctly after reload |  |
| Change country/address | Rate rules recalculate correctly |  |

## Campaign Notes

For each campaign tested, record:

- campaign name
- discount code used
- cart contents
- visible rates
- hidden rates
- discounted rates
- validation messages
- screenshots
