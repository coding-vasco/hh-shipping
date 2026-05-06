# Emergency Runbook

Use this when checkout is blocked, shipping rates disappear unexpectedly, or free shipping applies too broadly.

## Immediate Triage

1. Identify affected store.
2. Identify whether the issue is:
   - missing shipping rates
   - incorrect free shipping
   - checkout validation blocking
   - app/admin unavailable
3. Check whether a DSL publish or code deploy happened recently.

## Fastest Safe Mitigation

If app admin is accessible, publish:

```js
settings({
  productTags: ["box_shipping", "subs_box_mvp", "bf22_exc"],
});

campaigns([]);
```

This should make the Functions do nothing.

## If Admin Is Not Accessible

1. Check Render production service `hh-shipping-rules`.
2. If latest deploy failed, redeploy last known-good commit.
3. If the issue came from a Shopify extension deploy, redeploy the previous app version where possible or revert and deploy.

## After Stabilization

1. Save screenshots and checkout examples.
2. Record active DSL and compiled JSON.
3. Add a fixture test reproducing the issue before fixing it.
