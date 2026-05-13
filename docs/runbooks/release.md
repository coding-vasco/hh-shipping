# Release Runbook

## Development Release

Use the development app and Grace test store for all changes before production.

1. Work on `main`.
2. Run tests:

   ```powershell
   $env:DATABASE_URL='file:./dev.sqlite'
   npm run validate:production-rules
   npm run test:rules
   npm run build
   npm exec -- shopify app build
   ```

3. Push `main`.
4. Let Render deploy `hh-shipping`.
5. Deploy the dev Shopify app if extensions changed.
6. Test on Grace.

## Production Release

Only release production after Grace validation.

1. Merge or cherry-pick approved changes to `production`.
2. Run the same validation commands.
3. Push `production`.
4. Confirm Render `hh-shipping-rules` is live.
5. Deploy the production Shopify app:

   ```powershell
   $env:DATABASE_URL='file:./dev.sqlite'
   npm exec -- shopify app deploy --config production --allow-updates --allow-deletes --message "Production release"
   ```

6. Open each production store admin and verify app access.
7. Publish store-specific DSL only after the manual checkout matrix passes.

## Store Rollout Order

Roll out meaningful behavior changes to one production store first, monitor, then continue to the others.
