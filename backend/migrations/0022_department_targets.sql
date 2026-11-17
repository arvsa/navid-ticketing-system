-- Issues go to departments instead of groups (0023). A new enum value can't
-- be used in the transaction that adds it, so it gets its own migration.
ALTER TYPE target_kind ADD VALUE 'department';
