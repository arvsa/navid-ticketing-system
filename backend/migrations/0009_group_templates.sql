-- School-wide groups become templates (replacing 0008's cross-branch
-- membership). A school-wide group (`branch_id IS NULL`) has no members of
-- its own: every branch has its own copy (`template_id`), whose members the
-- branch admins choose and whose grants follow the template. New branches
-- get a copy of every active template.

ALTER TABLE user_group ADD COLUMN template_id uuid REFERENCES user_group (id) ON DELETE SET NULL;
ALTER TABLE user_group ADD CONSTRAINT user_group_template_in_branch CHECK (template_id IS NULL OR branch_id IS NOT NULL);
CREATE UNIQUE INDEX user_group_one_copy_per_branch ON user_group (branch_id, template_id) WHERE template_id IS NOT NULL;

-- The branch's copy of a template: an existing copy, else a same-named
-- ordinary group (adopted as is, grants untouched until the template's are
-- next saved), else a new group with the template's grants.
CREATE FUNCTION copy_group_template(p_template uuid, p_branch uuid) RETURNS uuid
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
        UPDATE user_group SET template_id = p_template WHERE id = g;
        RETURN g;
    END IF;
    INSERT INTO user_group (branch_id, name, description, created_by, template_id, archived_at)
    VALUES (p_branch, t.name, t.description, t.created_by, p_template, t.archived_at)
    RETURNING id INTO g;
    INSERT INTO group_permission (group_id, permission_key, issue_type_id, scope, granted_by)
    SELECT g, permission_key, issue_type_id, scope, granted_by FROM group_permission WHERE group_id = p_template;
    RETURN g;
END;
$$;

CREATE FUNCTION copy_group_templates_to_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM copy_group_template(id, NEW.id) FROM user_group WHERE branch_id IS NULL AND archived_at IS NULL;
    RETURN NEW;
END;
$$;

CREATE TRIGGER branch_group_templates
    AFTER INSERT ON branch
    FOR EACH ROW EXECUTE FUNCTION copy_group_templates_to_branch();

-- Existing school-wide groups: give every active branch its copy, and move
-- their members into the copy in each branch they currently belong to.
SELECT copy_group_template(g.id, b.id)
FROM user_group g CROSS JOIN branch b
WHERE g.branch_id IS NULL AND b.is_active;

INSERT INTO group_member (group_id, user_id, branch_id, added_by, added_at)
SELECT c.id, gm.user_id, c.branch_id, gm.added_by, gm.added_at
FROM group_member gm
JOIN user_group c ON c.template_id = gm.group_id
JOIN branch_membership m ON m.user_id = gm.user_id AND m.branch_id = c.branch_id AND m.left_at IS NULL
WHERE gm.branch_id IS NULL
ON CONFLICT DO NOTHING;

DELETE FROM group_member WHERE branch_id IS NULL;
DROP INDEX group_member_school_idx;
ALTER TABLE group_member ALTER COLUMN branch_id SET NOT NULL;
