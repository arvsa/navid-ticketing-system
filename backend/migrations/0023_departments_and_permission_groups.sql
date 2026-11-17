-- Departments and permission groups replace user groups.
--
-- A department is a business unit in a branch (IT, Health, Teachers):
-- issues are sent to it, its members get them, and its heads run the work
-- sent to it. It holds no permissions itself.
--
-- A permission group is a set of grants, for one branch or school-wide.
-- Attached to departments, its grants apply to their members in that
-- branch. The school-wide default group, "Everyone", applies to every user
-- in every branch without being attached.
--
-- What every user may do without any grant (create issues, send them to
-- anyone in any branch, edit and delete their own) is the baseline, in the
-- app's code. Who joins a department is decided by `department.manage`
-- holders and by `department.members.manage`, granted per department.
--
-- Existing data: every branch group becomes a department with the same id,
-- members and heads ("All members" becomes the branch's built-in
-- department). Each group's grants become a permission group with the same
-- id and name, attached to it; copies of a school-wide group get the
-- school-wide group attached instead. Group targets become department
-- targets.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

-- Creating and sending issues, to anyone in any branch, is the baseline.
DELETE FROM group_permission WHERE permission_key IN ('issue.create', 'issue.target', 'issue.target_other_branches');
DELETE FROM permission WHERE key IN ('issue.create', 'issue.target', 'issue.target_other_branches');

-- So is working on your own issues and on what's sent to you: grants are
-- only for other people's, branch-wide.
DELETE FROM group_permission WHERE scope <> 'branch';
UPDATE permission SET allowed_scopes = '{branch}';

-- A per-department permission is granted for named departments (or '*').
ALTER TABLE permission ADD COLUMN per_department boolean NOT NULL DEFAULT false;
INSERT INTO permission (key, description, per_issue_type, allowed_scopes, per_department) VALUES
    ('department.manage',         'Create, rename and archive departments and choose their heads', false, '{branch}', false),
    ('department.members.manage', 'Add people to departments and remove them',                     false, '{branch}', true);
UPDATE permission SET description = 'Edit other people''s issues' WHERE key = 'issue.edit';
UPDATE permission SET description = 'Close or cancel other people''s issues' WHERE key = 'issue.close';

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------

CREATE TABLE department (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id    uuid        NOT NULL REFERENCES branch (id),
    name         text        NOT NULL,
    description  text,
    is_default   boolean     NOT NULL DEFAULT false,      -- the branch's "All members": everyone, automatically
    created_by   uuid        REFERENCES app_user (id),
    archived_at  timestamptz,                             -- departments with history are archived, not deleted
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT department_name_uq UNIQUE (branch_id, name),
    CONSTRAINT department_id_branch_uq UNIQUE (id, branch_id),
    CONSTRAINT department_default_not_archived CHECK (NOT (is_default AND archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX department_one_default ON department (branch_id) WHERE is_default;
CREATE TRIGGER department_updated_at BEFORE UPDATE ON department FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE department_member (
    department_id uuid        NOT NULL,
    user_id       uuid        NOT NULL,
    branch_id     uuid        NOT NULL,
    is_head       boolean     NOT NULL DEFAULT false,
    added_by      uuid        REFERENCES app_user (id),
    added_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (department_id, user_id),
    -- the department and the person must both be in the same branch
    FOREIGN KEY (department_id, branch_id) REFERENCES department (id, branch_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, branch_id)       REFERENCES branch_membership (user_id, branch_id)
);

CREATE INDEX department_member_user_idx ON department_member (user_id, branch_id);

-- ---------------------------------------------------------------------------
-- Permission groups
-- ---------------------------------------------------------------------------

CREATE TABLE permission_group (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id    uuid        REFERENCES branch (id),      -- NULL = school-wide (root users)
    name         text        NOT NULL,
    description  text,
    is_default   boolean     NOT NULL DEFAULT false,      -- "Everyone": every user, every branch
    created_by   uuid        REFERENCES app_user (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT permission_group_name_uq UNIQUE NULLS NOT DISTINCT (branch_id, name),
    CONSTRAINT permission_group_default_school_wide CHECK (NOT is_default OR branch_id IS NULL)
);

CREATE UNIQUE INDEX permission_group_one_default ON permission_group ((true)) WHERE is_default;
CREATE TRIGGER permission_group_updated_at BEFORE UPDATE ON permission_group FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE permission_group_grant (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        uuid             NOT NULL REFERENCES permission_group (id) ON DELETE CASCADE,
    permission_key  text             NOT NULL REFERENCES permission (key),
    issue_type_id   smallint         REFERENCES issue_type (id),  -- NULL = all types
    scope           permission_scope NOT NULL,
    -- Per-department permissions: a department name (any letter case) or
    -- '*' for every department of the branch the grant applies in.
    department      text,
    granted_by      uuid             REFERENCES app_user (id),
    created_at      timestamptz      NOT NULL DEFAULT now(),
    CONSTRAINT permission_group_grant_uq
        UNIQUE NULLS NOT DISTINCT (group_id, permission_key, issue_type_id, scope, department)
);

CREATE INDEX permission_group_grant_group_idx ON permission_group_grant (group_id);

CREATE TABLE department_permission_group (
    department_id uuid        NOT NULL REFERENCES department (id) ON DELETE CASCADE,
    group_id      uuid        NOT NULL REFERENCES permission_group (id) ON DELETE CASCADE,
    attached_by   uuid        REFERENCES app_user (id),
    attached_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (department_id, group_id)
);

CREATE INDEX department_permission_group_group_idx ON department_permission_group (group_id);

-- ---------------------------------------------------------------------------
-- Moving the data over
-- ---------------------------------------------------------------------------

INSERT INTO department (id, branch_id, name, description, is_default, created_by, archived_at, created_at, updated_at)
SELECT id, branch_id, name, description, is_default, created_by, archived_at, created_at, updated_at
FROM user_group WHERE branch_id IS NOT NULL;

INSERT INTO department_member (department_id, user_id, branch_id, is_head, added_by, added_at)
SELECT group_id, user_id, branch_id, is_head, added_by, added_at FROM group_member;

-- School-wide groups ("Everyone" included) become school-wide permission
-- groups; branch groups of their own with grants left become branch ones.
INSERT INTO permission_group (id, branch_id, name, description, is_default, created_by, created_at, updated_at)
SELECT g.id, g.branch_id, g.name, g.description, g.is_default AND g.branch_id IS NULL, g.created_by, g.created_at, g.updated_at
FROM user_group g
WHERE g.branch_id IS NULL
   OR (g.template_id IS NULL AND EXISTS (SELECT 1 FROM group_permission gp WHERE gp.group_id = g.id));

INSERT INTO permission_group_grant (id, group_id, permission_key, issue_type_id, scope, granted_by, created_at)
SELECT gp.id, gp.group_id, gp.permission_key, gp.issue_type_id, gp.scope, gp.granted_by, gp.created_at
FROM group_permission gp JOIN permission_group pg ON pg.id = gp.group_id;

-- Each department gets its own group's grants, or its school-wide group's.
INSERT INTO department_permission_group (department_id, group_id, attached_by, attached_at)
SELECT g.id, coalesce(g.template_id, g.id), g.created_by, g.created_at
FROM user_group g
JOIN permission_group pg ON pg.id = coalesce(g.template_id, g.id)
WHERE g.branch_id IS NOT NULL;

-- Group targets become department targets (same ids).
ALTER TABLE issue_target ADD COLUMN department_id uuid;
ALTER TABLE issue_target DROP CONSTRAINT issue_target_shape;
UPDATE issue_target SET kind = 'department', department_id = group_id WHERE kind = 'group';
ALTER TABLE issue_target DROP COLUMN group_id;  -- with its foreign key and indexes
ALTER TABLE issue_target
    ADD CONSTRAINT issue_target_shape CHECK (
        (kind = 'branch'     AND department_id IS NULL     AND user_id IS NULL)     OR
        (kind = 'department' AND department_id IS NOT NULL AND user_id IS NULL)     OR
        (kind = 'user'       AND user_id IS NOT NULL       AND department_id IS NULL)
    ),
    ADD CONSTRAINT issue_target_department_fk
        FOREIGN KEY (department_id, branch_id) REFERENCES department (id, branch_id);
CREATE UNIQUE INDEX issue_target_once ON issue_target (issue_id, branch_id, department_id, user_id)
    NULLS NOT DISTINCT WHERE removed_at IS NULL;
CREATE INDEX issue_target_department_idx ON issue_target (department_id) WHERE department_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The old groups go
-- ---------------------------------------------------------------------------

DROP TRIGGER branch_default_group ON branch;
DROP TRIGGER branch_group_templates ON branch;
DROP TRIGGER branch_membership_default_group ON branch_membership;
DROP TABLE group_permission, group_member, user_group;
DROP FUNCTION create_default_group(), copy_group_templates_to_branch(), copy_group_template(uuid, uuid),
    sync_default_group_membership(), check_group_member_active(), check_group_member_branch(),
    protect_default_group(), check_group_permission(), clear_heads_of_teams();

-- ---------------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------------

-- Every new branch gets its "All members" department, with an "All members"
-- permission group holding the usual branch-wide permissions.
CREATE FUNCTION create_default_department() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    d uuid;
    g uuid;
BEGIN
    INSERT INTO department (branch_id, name, description, is_default, created_by)
    VALUES (NEW.id, 'All members', 'Everyone in the branch.', true, NEW.created_by)
    RETURNING id INTO d;
    INSERT INTO permission_group (branch_id, name, description, created_by)
    VALUES (NEW.id, 'All members', 'What everyone in the branch may do.', NEW.created_by)
    RETURNING id INTO g;
    INSERT INTO permission_group_grant (group_id, permission_key, scope)
    VALUES (g, 'issue.read', 'branch'), (g, 'comment.create', 'branch'), (g, 'member.view', 'branch');
    INSERT INTO department_permission_group (department_id, group_id, attached_by) VALUES (d, g, NEW.created_by);
    RETURN NEW;
END;
$$;

CREATE TRIGGER branch_default_department
    AFTER INSERT ON branch
    FOR EACH ROW EXECUTE FUNCTION create_default_department();

-- Joining a branch puts you in its "All members" department; leaving
-- removes you from every department in that branch.
CREATE FUNCTION sync_default_department_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.left_at IS NULL AND (TG_OP = 'INSERT' OR OLD.left_at IS NOT NULL) THEN
        INSERT INTO department_member (department_id, user_id, branch_id, added_by)
        SELECT d.id, NEW.user_id, NEW.branch_id, NEW.added_by
        FROM department d
        WHERE d.branch_id = NEW.branch_id AND d.is_default
        ON CONFLICT DO NOTHING;
    ELSIF NEW.left_at IS NOT NULL AND TG_OP = 'UPDATE' AND OLD.left_at IS NULL THEN
        DELETE FROM department_member WHERE user_id = NEW.user_id AND branch_id = NEW.branch_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER branch_membership_default_department
    AFTER INSERT OR UPDATE OF left_at ON branch_membership
    FOR EACH ROW EXECUTE FUNCTION sync_default_department_membership();

-- Only current branch members can join a department.
CREATE FUNCTION check_department_member_active() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM branch_membership
               WHERE user_id = NEW.user_id AND branch_id = NEW.branch_id AND left_at IS NOT NULL) THEN
        RAISE EXCEPTION 'user % has left branch %', NEW.user_id, NEW.branch_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER department_member_active
    BEFORE INSERT ON department_member
    FOR EACH ROW EXECUTE FUNCTION check_department_member_active();

-- The built-in "All members" department and "Everyone" permission group
-- can't be deleted or demoted.
CREATE FUNCTION protect_defaults() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.is_default THEN
        RAISE EXCEPTION 'a built-in % cannot be deleted', TG_TABLE_NAME;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.is_default <> NEW.is_default THEN
        RAISE EXCEPTION 'is_default cannot be changed';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER department_protect_default
    BEFORE UPDATE OR DELETE ON department
    FOR EACH ROW EXECUTE FUNCTION protect_defaults();
CREATE TRIGGER permission_group_protect_default
    BEFORE UPDATE OR DELETE ON permission_group
    FOR EACH ROW EXECUTE FUNCTION protect_defaults();

-- A grant uses a scope the permission allows, names an issue type only when
-- the permission is per-type, and names departments exactly when it is
-- per-department.
CREATE FUNCTION check_permission_group_grant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    p permission%ROWTYPE;
BEGIN
    SELECT * INTO p FROM permission WHERE key = NEW.permission_key;
    IF NOT NEW.scope = ANY (p.allowed_scopes) THEN
        RAISE EXCEPTION 'scope % is not allowed for %', NEW.scope, NEW.permission_key;
    END IF;
    IF NEW.issue_type_id IS NOT NULL AND NOT p.per_issue_type THEN
        RAISE EXCEPTION '% cannot be limited to an issue type', NEW.permission_key;
    END IF;
    IF (NEW.department IS NOT NULL) <> p.per_department THEN
        RAISE EXCEPTION '% %', NEW.permission_key,
            CASE WHEN p.per_department THEN 'needs a department' ELSE 'cannot name a department' END;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER permission_group_grant_valid
    BEFORE INSERT OR UPDATE ON permission_group_grant
    FOR EACH ROW EXECUTE FUNCTION check_permission_group_grant();

-- A department takes permission groups of its own branch or school-wide
-- ones; "Everyone" applies without being attached.
CREATE FUNCTION check_department_permission_group() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    g permission_group%ROWTYPE;
BEGIN
    SELECT * INTO g FROM permission_group WHERE id = NEW.group_id;
    IF g.is_default THEN
        RAISE EXCEPTION '"%" applies to everyone; it is not attached to departments', g.name;
    END IF;
    IF g.branch_id IS NOT NULL AND g.branch_id <> (SELECT branch_id FROM department WHERE id = NEW.department_id) THEN
        RAISE EXCEPTION 'permission group % belongs to another branch', g.name;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER department_permission_group_valid
    BEFORE INSERT OR UPDATE ON department_permission_group
    FOR EACH ROW EXECUTE FUNCTION check_department_permission_group();

-- ---------------------------------------------------------------------------
-- Deleting your own issues (soft: hidden from everyone, history kept)
-- ---------------------------------------------------------------------------

ALTER TABLE issue ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by uuid REFERENCES app_user (id);

-- Department targets instead of group targets; deleted issues are seen by no one.
CREATE OR REPLACE FUNCTION issue_visible(
    p_issue_id   uuid,
    p_branch_id  uuid,
    p_type_id    smallint,
    p_created_by uuid,
    f            jsonb
) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT NOT EXISTS (SELECT 1 FROM issue WHERE id = p_issue_id AND deleted_at IS NOT NULL) AND (
        coalesce((f->>'super')::boolean, false)
        -- own, while still a member of the issue's branch
        OR (p_created_by = (f->>'me')::uuid AND (p_branch_id IS NULL OR f->'branches' ? p_branch_id::text))
        -- targeted: user target or branch target (in a current branch), current member of a department target
        OR EXISTS (
            SELECT 1 FROM issue_target t
            WHERE t.issue_id = p_issue_id AND t.removed_at IS NULL AND (
                   (t.user_id = (f->>'me')::uuid AND f->'branches' ? t.branch_id::text)
                OR t.department_id IN (SELECT dm.department_id FROM department_member dm WHERE dm.user_id = (f->>'me')::uuid)
                OR (t.kind = 'branch' AND f->'branches' ? t.branch_id::text)))
        -- targeted: assignee of a work item of an active target, in a current branch
        OR EXISTS (
            SELECT 1 FROM work_item w JOIN issue_target t ON t.id = w.target_id
            WHERE w.issue_id = p_issue_id AND w.assignee_id = (f->>'me')::uuid AND t.removed_at IS NULL
              AND f->'branches' ? w.branch_id::text)
        -- branch-level access, in the issue's branch or, for a cross-branch
        -- issue, in any branch it targets
        OR EXISTS (
            SELECT 1
            FROM (SELECT p_branch_id AS b WHERE p_branch_id IS NOT NULL
                  UNION
                  SELECT t.branch_id FROM issue_target t
                  WHERE p_branch_id IS NULL AND t.issue_id = p_issue_id AND t.removed_at IS NULL) ib
            CROSS JOIN (SELECT code FROM issue_type WHERE id = p_type_id) ty
            WHERE f->'admin' ? ib.b::text
               OR f->'read' ?| ARRAY[ib.b::text || ':*', ib.b::text || ':' || ty.code]))
$$;

-- ---------------------------------------------------------------------------
-- "Added to a group" notifications are about departments now
-- ---------------------------------------------------------------------------

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
UPDATE notification
SET kind = 'added_to_department',
    payload = (payload - 'group_id' - 'group_name')
              || jsonb_build_object('department_id', payload->'group_id', 'department_name', payload->'group_name')
WHERE kind = 'added_to_group';
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
    'assigned', 'unassigned', 'mentioned', 'commented',
    'status_changed', 'submitted_for_approval', 'approved', 'rejected',
    'changed_by_admin', 'ticket_created',
    'event_invited', 'event_updated', 'event_cancelled', 'event_reminder',
    'sla_due_soon', 'sla_breached',
    'added_to_department', 'permissions_changed'));
