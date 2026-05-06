# HH Shipping Rules Production Deployment

## Branches

- `main`: development app, tested on `grace-handmade-jewelry.myshopify.com`.
- `production`: production app, installed on the real stores.

Promotion flow:

```txt
Build on main -> test on Grace -> merge main into production -> deploy production app -> publish rules per store
```

## Production Stores

- `hey-harper-shop-us.myshopify.com`
- `hey-harper-shop-uk.myshopify.com`
- `hey-harper-shop-nl.myshopify.com`

## Required Render Environment Variables

Set these on the production Render service:

```txt
SHOPIFY_API_KEY=<production app Client ID>
SHOPIFY_API_SECRET=<production app Client secret>
SHOPIFY_APP_URL=https://hh-shipping-rules.onrender.com
SCOPES=read_delivery_customizations,write_delivery_customizations,read_discounts,write_discounts,read_validations,write_validations
DATABASE_URL=file:/var/data/prod.sqlite
```

Use a Render persistent disk mounted at `/var/data` when using the SQLite URL above.

## Shopify Production App Setup

1. Create a new app in the Hey Harper Trading Shopify dev dashboard.
2. Name it `HH Shipping Rules`.
3. Copy the production app Client ID into `shopify.app.production.toml`.
4. Copy the Client ID and Client secret into the production Render service env vars.
5. Set the production app URL and redirect URLs to the Render production URL.
6. Deploy Shopify extensions with the production config.
7. Install the app on each production store.
8. Open the app in each store and click `Save and publish` with that store's DSL.
9. Add the `HH Shipping Rules` checkout app block near shipping methods in each store's checkout editor.

## Commands

Run from the repo root in Windows PowerShell.

```powershell
git checkout production
git merge main
npm run test:rules
npm run validate:production-rules
npm run build
npm exec -- shopify app config use production
npm exec -- shopify app deploy --allow-updates --message "Production release"
```

Render should auto-deploy the `production` branch if the production service is configured to track that branch.

If a production DSL change is intentional, update snapshots before opening the PR:

```powershell
npm run snapshot:production
npm run test:rules
```

## Per-Store Publishing

The embedded app stores one rules script per shop. After the production app is installed on each store:

1. Open `Apps > HH Shipping Rules` in the store admin.
2. Paste or edit the store-specific DSL.
3. Click `Save and publish`.
4. Confirm the status row shows delivery config published, discount function active when shipping discounts exist, and validation active when validations exist.
5. Smoke test checkout with that store's known campaign codes.
