-- A one-off data fix for this shop, on this date. It is not a schema change
-- and it is not a rule: it runs once, on the deploy that carries it, and never
-- again.
--
-- Why it exists. Nineteen of twenty live listings were telling buyers to
-- collect during 7–13 September, a week that had already passed, because the
-- pickup window used to carry forward from the seller's most recent item and
-- nothing in that chain ever re-asked. The schema change that fixes it going
-- forward (20260914180239_sale_window) cannot fix the rows that are already
-- wrong, and the seller asked for the sale to run "from now until 28 Sep".
-- Shipping them a button to press instead of pressing it is leaving the shop
-- lying to buyers for as long as it takes them to notice the button.
--
-- 2026-09-15 is the deploy date; 2026-09-28 is the last day of the sale.
--
-- Both statements carry `DATE '2026-09-28' >= CURRENT_DATE`. The dates here
-- are hard-coded, and a migration that ran for the first time in October would
-- otherwise write a window that had already closed onto every item in the shop
-- — which is the exact bug this whole change exists to fix, reintroduced by
-- the fix for it. Guarded, a late deploy simply does nothing, and an unset
-- window falls back to today → today+14, which can never be in the past.
--
-- The start is GREATEST(CURRENT_DATE, …) for the same reason from the other
-- end: a deploy on the 20th should tell buyers to come from the 20th, not
-- advertise five days that have gone.

-- The window every NEW item will open with. A no-op on a database whose
-- Settings row does not exist yet (a fresh install seeds it afterwards, with
-- both dates null, which is the correct first-run state).
UPDATE "Settings"
SET "saleFrom" = GREATEST(CURRENT_DATE, DATE '2026-09-15'), "saleTo" = DATE '2026-09-28'
WHERE "id" = 1
  AND DATE '2026-09-28' >= CURRENT_DATE;

-- Every item the shop is free to move, which is the same rule
-- `setPickupWindowForAll` enforces from the admin screen: an item a live order
-- is holding keeps its dates. That order recorded a pickupDate inside the
-- window its buyer was shown, and on a CLAIMED_PAID or PAID order that buyer
-- has already sent money — moving the item under them would leave the shop
-- promising one thing and the order saying another.
--
-- NOT EXISTS over the join, not a comparison on a nullable column: an item
-- with no orders at all must be updated, and `"orderId" <> …` would be NULL
-- for exactly those rows and quietly skip every one of them.
UPDATE "Item" i
SET "pickupFrom" = GREATEST(CURRENT_DATE, DATE '2026-09-15'), "pickupTo" = DATE '2026-09-28'
WHERE DATE '2026-09-28' >= CURRENT_DATE
  AND i."status" <> 'RESERVED'
  AND NOT EXISTS (
    SELECT 1
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    WHERE oi."itemId" = i."id"
      AND o."status" IN ('PENDING_PAYMENT', 'CLAIMED_PAID', 'PAID')
  );
