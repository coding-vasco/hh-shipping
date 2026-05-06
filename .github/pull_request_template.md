## HH Shipping Rules Production Safety Checklist

### Change category
- [ ] Documentation only
- [ ] Admin UI only
- [ ] DSL/compiler
- [ ] Shopify Function runtime
- [ ] Checkout UI Extension
- [ ] Production DSL/config
- [ ] Publishing/OAuth/session/database

### Checkout behavior
- [ ] No checkout behavior change
- [ ] Checkout behavior intentionally changed
- [ ] Behavior change documented below

### Testing
- [ ] Unit tests pass
- [ ] DSL validation passes
- [ ] Production DSL files compile
- [ ] Function fixtures pass
- [ ] Golden snapshots pass
- [ ] Manual Grace checkout test required
- [ ] Manual Grace checkout test completed

### Rollback
- [ ] Rollback is code revert only
- [ ] Rollback requires previous DSL/config publish
- [ ] Rollback requires Render redeploy
- [ ] Rollback instructions included

### Production risk
- [ ] Low
- [ ] Medium
- [ ] High
- [ ] Critical

### Notes

Describe what changed, why it changed, and what should be monitored.
