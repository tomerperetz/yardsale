-- The five categories a shop starts with. See src/lib/starter-categories.ts
-- for why they exist; this file is the only copy that reaches a deployed
-- database, because `npm start` runs `prisma migrate deploy` and never the
-- seed. Keep the two lists in step.
--
-- ON CONFLICT DO NOTHING, with no target, so that a shop already holding a
-- category by one of these names — or, improbably, by one of these slugs —
-- keeps the row it has, with its items attached. Running this against the
-- live shop adds only the names it is missing.
--
-- The slugs are fixed rather than suffixed the way `hebrewSlug` makes them:
-- nothing routes on a category slug, and a migration that generated a random
-- one would not be the same migration twice.
INSERT INTO "Category" ("id", "name", "slug") VALUES
  ('cat_starter_furniture',   'ריהוט',      'rihut-starter'),
  ('cat_starter_electronics', 'אלקטרוניקה', 'electronica-starter'),
  ('cat_starter_children',    'ילדים',      'yeladim-starter'),
  ('cat_starter_maternity',   'הריון ולידה', 'herayon-leida-starter'),
  ('cat_starter_sport',       'ציוד ספורט', 'tziyud-sport-starter')
ON CONFLICT DO NOTHING;
