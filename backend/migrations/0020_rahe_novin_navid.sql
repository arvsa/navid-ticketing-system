-- The schools are Rahe Novin Navid Schools. A name someone chose is kept.
ALTER TABLE app_settings ALTER COLUMN school_name SET DEFAULT 'Rahe Novin Navid Schools';
UPDATE app_settings SET school_name = 'Rahe Novin Navid Schools' WHERE school_name = 'Navid Schools';
