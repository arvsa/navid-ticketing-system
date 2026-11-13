-- The temporary password an admin handed out, kept readable for operators
-- (`users` CLI) until the person replaces it. Passwords people choose are
-- never stored: changing the hash any other way clears this.
ALTER TABLE app_user ADD COLUMN temporary_password text;

CREATE FUNCTION app_user_clear_temporary_password() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
       AND NEW.temporary_password IS NOT DISTINCT FROM OLD.temporary_password THEN
        NEW.temporary_password := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER app_user_clear_temporary_password
    BEFORE UPDATE OF password_hash ON app_user
    FOR EACH ROW EXECUTE FUNCTION app_user_clear_temporary_password();
