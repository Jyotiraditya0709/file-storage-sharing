-- Custom migration (drizzle-kit generate --custom): drizzle-kit does not emit
-- extension statements. citext gives us case-insensitive unique emails in the
-- database rather than by lower()-ing in application code.
CREATE EXTENSION IF NOT EXISTS citext;
