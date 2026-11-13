-- Departments and their heads.
--
-- A group is a department (IT, Health: people who handle work for others)
-- or a team (a role or committee: Principals, Teachers). Only departments
-- are listed as the school's departments.
--
-- A department's heads run it without being branch admins: they choose its
-- members, hand out, approve or send back work sent to it, and close the
-- questions sent to it.

ALTER TABLE user_group ADD COLUMN kind text NOT NULL DEFAULT 'team'
    CONSTRAINT user_group_kind CHECK (kind IN ('team', 'department'));
ALTER TABLE group_member ADD COLUMN is_head boolean NOT NULL DEFAULT false;

-- A branch's copy of a school-wide group follows its kind, like its name.
CREATE OR REPLACE FUNCTION copy_group_template(p_template uuid, p_branch uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    t user_group%ROWTYPE;
    g uuid;
BEGIN
    SELECT * INTO t FROM user_group WHERE id = p_template AND branch_id IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'group % is not a school-wide group', p_template;
    END IF;
    SELECT id INTO g FROM user_group WHERE branch_id = p_branch AND template_id = p_template;
    IF g IS NOT NULL THEN
        RETURN g;
    END IF;
    SELECT id INTO g FROM user_group
    WHERE branch_id = p_branch AND lower(name) = lower(t.name) AND NOT is_default AND template_id IS NULL;
    IF g IS NOT NULL THEN
        UPDATE user_group SET template_id = p_template, kind = t.kind WHERE id = g;
        RETURN g;
    END IF;
    INSERT INTO user_group (branch_id, name, description, created_by, template_id, archived_at, kind)
    VALUES (p_branch, t.name, t.description, t.created_by, p_template, t.archived_at, t.kind)
    RETURNING id INTO g;
    INSERT INTO group_permission (group_id, permission_key, issue_type_id, scope, granted_by)
    SELECT g, permission_key, issue_type_id, scope, granted_by FROM group_permission WHERE group_id = p_template;
    RETURN g;
END;
$$;

-- Only departments have heads; a group turned back into a team loses them.
CREATE FUNCTION clear_heads_of_teams() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind = 'team' AND OLD.kind = 'department' THEN
        UPDATE group_member SET is_head = false WHERE group_id = NEW.id AND is_head;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER user_group_clear_heads
    AFTER UPDATE OF kind ON user_group
    FOR EACH ROW EXECUTE FUNCTION clear_heads_of_teams();
