BEGIN;
ALTER TABLE accounts
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN google_sub text UNIQUE;
COMMIT;
