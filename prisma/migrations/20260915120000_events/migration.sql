-- One row per thing a visitor did. See the model's comment in schema.prisma
-- for why this lives here rather than in a third-party tracker.
CREATE TYPE "EventKind" AS ENUM ('VIEW_SHOP', 'VIEW_ITEM', 'ADD_TO_CART');

CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "kind" "EventKind" NOT NULL,
    "itemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");
CREATE INDEX "Event_itemId_kind_idx" ON "Event"("itemId", "kind");
CREATE INDEX "Event_visitorId_idx" ON "Event"("visitorId");

-- ON DELETE CASCADE: deleting an item takes its history with it, so
-- `deleteItem` keeps working without knowing this table exists.
ALTER TABLE "Event" ADD CONSTRAINT "Event_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
