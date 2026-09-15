-- When a model last wrote an item's description. NULL for every item that
-- exists today, which is correct: none of them have been written by the
-- shop-wide rewrite, and offering them all is exactly what it is for.
ALTER TABLE "Item" ADD COLUMN "descriptionWrittenAt" TIMESTAMP(3);
