export function friendlyError(e: unknown): string {
  const msg = String((e as any)?.message ?? e);
  const logs = JSON.stringify((e as any)?.logs ?? "");
  const all = msg + logs;
  if (/User rejected|rejected the request|Transaction cancelled/i.test(all)) return "You cancelled the request in your wallet.";
  if (/HolderLimitExceeded|already sold/i.test(all)) return "This wallet already used its sell limit for this window. Sell less, or wait for the window to reset.";
  if (/SlippageExceeded|Slippage/i.test(all)) return "The price moved while you were signing. Try again.";
  if (/NothingToClaim|No fees to claim/i.test(all)) return "No rewards to claim yet. They build up when other holders sell early.";
  if (/NeedsPoolStep/i.test(all)) return "Graduation has to run as one transaction. Please try again from the token page.";
  if (/NotComplete/i.test(all)) return "This token is not full yet, so it cannot graduate.";
  if (/AlreadyGraduating|graduating/i.test(all)) return "This token is graduating. Trading on the curve has ended.";
  if (/PoolNotFilled|BadPrice/i.test(all)) return "The pool setup was refused as unsafe. Nothing was spent. Try again.";
  if (/Paused|paused/.test(all)) return "New buys and new tokens are paused right now. Selling and claiming rewards still work.";
  if (/CurveComplete/i.test(all)) return "This token’s curve is full. Trading here has ended.";
  if (/insufficient lamports|Attempt to debit an account but found no record of a prior credit|insufficient funds/i.test(all))
    return "Not enough SOL in this wallet.";
  if (/MathError|too small/i.test(all)) return "That amount is too small or too large to trade.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}
