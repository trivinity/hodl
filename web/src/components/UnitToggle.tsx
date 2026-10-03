"use client";
import { useSolUsd, useUnit } from "@/lib/useUnit";

/** SOL / USD switch for market caps. USD stays off until the dollar price has loaded. */
export default function UnitToggle() {
  const [unit, setUnit] = useUnit();
  const usd = useSolUsd();
  const shown = unit === "USD" && usd ? "USD" : "SOL";
  return (
    <div className="seg" role="group" aria-label="Show values in">
      <button type="button" className={shown === "SOL" ? "seg-on" : ""} onClick={() => setUnit("SOL")}>
        SOL
      </button>
      <button type="button" className={shown === "USD" ? "seg-on" : ""} disabled={!usd} title={usd ? undefined : "Dollar price not available"} onClick={() => setUnit("USD")}>
        USD
      </button>
    </div>
  );
}
