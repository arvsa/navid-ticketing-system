-- Permissions for everyone. One school-wide default group, "Everyone", run
-- by super admins: its grants apply to every user in every branch they
-- belong to, on top of what their branch groups give them. It has no
-- members (everyone is in it) and no branch copies, and like a branch's
-- "All members" it can't be renamed, archived or deleted.

ALTER TABLE user_group DROP CONSTRAINT user_group_school_not_default;
CREATE UNIQUE INDEX user_group_one_everyone ON user_group ((true)) WHERE branch_id IS NULL AND is_default;

INSERT INTO user_group (branch_id, name, description, is_default)
VALUES (NULL, 'Everyone', 'Permissions for every user in every branch.', true);

-- New branches copy the school-wide groups, but not this one.
CREATE OR REPLACE FUNCTION copy_group_templates_to_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM copy_group_template(id, NEW.id) FROM user_group
    WHERE branch_id IS NULL AND archived_at IS NULL AND NOT is_default;
    RETURN NEW;
END;
$$;
