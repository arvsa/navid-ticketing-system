-- A branch can be opened before it has people: create it, import its
-- members, then appoint an admin. What stays guaranteed: once a branch has
-- an admin, its last one can't be demoted, removed or deactivated (the
-- membership and user triggers below still check that).

-- Opening (or reopening) a branch no longer requires an admin.
DROP TRIGGER branch_needs_admin ON branch;
DROP FUNCTION check_branch_has_admin();

-- Membership changes are checked only when they take an admin away, so a
-- branch with no admin yet can still change its members.
CREATE OR REPLACE FUNCTION check_membership_keeps_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.is_admin AND OLD.left_at IS NULL
       AND (TG_OP = 'DELETE' OR NOT NEW.is_admin OR NEW.left_at IS NOT NULL) THEN
        PERFORM assert_branch_has_admin(OLD.branch_id);
    END IF;
    RETURN NULL;
END;
$$;
