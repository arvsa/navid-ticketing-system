-- School-wide groups: a group with no branch (`branch_id IS NULL`). Only
-- super admins run them. Anyone currently in a branch can be a member, and
-- the group's grants apply in every branch the member currently belongs to.
-- They can't be issue targets: issue_target's (group_id, branch_id) foreign
-- key needs a branch group.

ALTER TABLE user_group ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE user_group ADD CONSTRAINT user_group_school_not_default CHECK (branch_id IS NOT NULL OR NOT is_default);
CREATE UNIQUE INDEX user_group_school_name_uq ON user_group (lower(name)) WHERE branch_id IS NULL;

-- Members of a school-wide group have no branch. The composite keys below
-- skip NULLs, so the group and the user get plain keys as well.
ALTER TABLE group_member ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE group_member
    ADD CONSTRAINT group_member_group_fk FOREIGN KEY (group_id) REFERENCES user_group (id) ON DELETE CASCADE,
    ADD CONSTRAINT group_member_user_fk FOREIGN KEY (user_id) REFERENCES app_user (id);
CREATE INDEX group_member_school_idx ON group_member (user_id) WHERE branch_id IS NULL;

-- A member row carries its group's branch: NULL exactly for school-wide groups.
CREATE FUNCTION check_group_member_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.branch_id IS DISTINCT FROM (SELECT branch_id FROM user_group WHERE id = NEW.group_id) THEN
        RAISE EXCEPTION 'group member branch must match the group''s branch';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER group_member_branch
    BEFORE INSERT OR UPDATE ON group_member
    FOR EACH ROW EXECUTE FUNCTION check_group_member_branch();
