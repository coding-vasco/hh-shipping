# Rollback Runbook

Rollback depends on what changed.

## Bad DSL Publish

1. Open `HH Shipping Rules` in the affected store.
2. Re-publish the previous known-good DSL from Git.
3. If needed, publish an empty ruleset:

   ```js
   settings({
     productTags: ["box_shipping", "subs_box_mvp", "bf22_exc"],
   });

   campaigns([]);
   ```

4. Retest checkout.

## Bad Code Deploy

1. Revert the bad commit on the affected branch.
2. Push the branch.
3. Wait for Render deploy.
4. If extensions changed, redeploy the Shopify app from the reverted branch.
5. Retest checkout.

## Bad Checkout Blocking Behavior

1. Prefer publishing an empty `CartValidation` config or disabling the specific validation campaign.
2. If the UI/admin app is inaccessible, revert code and redeploy.
3. Retest NOMORERUST and a normal checkout.

## Bad Rate Hiding Behavior

1. Publish a DSL that disables the offending `HideRates` campaign with `enabled: false`.
2. If uncertain, publish `campaigns([])`.
3. Retest visible shipping rates.
