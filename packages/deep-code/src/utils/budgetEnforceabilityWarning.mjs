// --max-budget-usd (headless `--print` only) caps total USD spend, but the cap
// can only fire if the active model's per-token USD cost is known. This fork is
// DeepSeek-native and prices DeepSeek input-only (no output price assumed), so a
// DeepSeek model has no USD pricing — the cap would silently never trigger,
// giving the user a false sense of a spending limit.
//
// Rather than fail silently, surface a loud startup warning. This does NOT
// invent a price or revive cost tracking (that needs DeepSeek output pricing, a
// separate decision); it just makes the non-enforcement explicit.
//
// Returns the warning text, or null when no warning is warranted: no budget set,
// or the active model IS priceable (its cap could fire once cost accrual is
// wired).
//
// @param {number|null|undefined} maxBudgetUsd  the --max-budget-usd value (validated positive upstream, or unset)
// @param {boolean} modelPriceable  whether the active model has a USD price entry
// @param {string} model  the active model id (shown in the message)
// @returns {string|null}
export function budgetEnforceabilityWarning(maxBudgetUsd, modelPriceable, model) {
  if (maxBudgetUsd == null) return null
  if (modelPriceable) return null
  return (
    `⚠ --max-budget-usd ($${maxBudgetUsd}) will NOT be enforced: ` +
    `no USD pricing is available for model "${model}", so the spend cap cannot ` +
    `be computed. This session will run WITHOUT a budget limit.`
  )
}
