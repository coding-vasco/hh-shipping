# Production Store DSL Files

Use these files when installing `HH Shipping Rules` on the production stores.

| Store | DSL file | Source |
| --- | --- | --- |
| `hey-harper-shop-nl.myshopify.com` | `hey-harper-shop-nl.dsl.js` | EU Script Editor rules + NOMORERUST |
| `hey-harper-shop-uk.myshopify.com` | `hey-harper-shop-uk.dsl.js` | UK Script Editor rules + NOMORERUST |
| `hey-harper-shop-us.myshopify.com` | `hey-harper-shop-us.dsl.js` | US Script Editor rules + NOMORERUST |

Before disabling Script Editor, paste the matching DSL into the production app, click `Save and publish`, then validate the store-specific checklist with ops.

If the live Script Editor scripts changed after the May 5 exports, refresh the script exports and update these DSL files before rollout.

Validate these files before publishing:

```powershell
$env:DATABASE_URL='file:./dev.sqlite'
npm run validate:production-rules
npm run test:rules
```

The validator fails when a required store DSL file is missing, a DSL does not compile, compiled rule IDs collide, or the compiled JSON does not match its snapshot. It prints warnings for rules that depend on checkout discount-code sync, hide all rates, apply shipping discounts, or block checkout.

Useful variants:

```powershell
npm run validate:production-rules -- --store hey-harper-shop-nl.myshopify.com
npm run validate:production-rules -- --json
npm run validate:production-rules -- --strict
npm run validate:production-rules -- --no-snapshots
```

If the compiled output changes intentionally, update golden snapshots:

```powershell
npm run snapshot:production
```
