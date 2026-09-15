-- How many times a model has failed to describe an item. Existing rows start
-- at 0, which is correct: none of them have been tried.
ALTER TABLE "Item" ADD COLUMN "descriptionAttempts" INTEGER NOT NULL DEFAULT 0;
