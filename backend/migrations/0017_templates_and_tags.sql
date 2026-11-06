-- Templates and tags. A template is a named starting point for a new issue:
-- a base type, a tag it puts on the issue, and rules that come with it. The
-- "report" type becomes the built-in Report template, an action whose work
-- needs a written report before it goes for approval.
--
-- Templates are school-wide and run by super admins. `fields` is reserved for
-- custom fields (a JSON array of field definitions); nothing reads it yet.

CREATE TABLE issue_template (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    description        text        CHECK (length(description) BETWEEN 1 AND 500),
    type_id            smallint    NOT NULL REFERENCES issue_type (id),
    -- added to every issue made from the template; NULL = no tag
    tag                text        CHECK (length(tag) BETWEEN 1 AND 40),
    -- actions only: each piece of work needs a submitted written report
    requires_report    boolean     NOT NULL DEFAULT false,
    default_sla_hours  integer     CHECK (default_sla_hours > 0),
    fields             jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(fields) = 'array'),
    position           integer     NOT NULL DEFAULT 0,
    archived_at        timestamptz,
    created_by         uuid        REFERENCES app_user (id),
    version            integer     NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX issue_template_name_uq ON issue_template (lower(name)) WHERE archived_at IS NULL;

INSERT INTO issue_template (name, description, type_id, tag, requires_report, default_sla_hours)
SELECT 'Report', 'A written report, submitted for approval when assigned', id, 'report', true, 168
FROM issue_type WHERE code = 'action';

-- Issues remember their template, carry tags, and fix the report rule when
-- they are created, so later template edits don't change existing work.
ALTER TABLE issue
    ADD COLUMN template_id     uuid    REFERENCES issue_template (id),
    ADD COLUMN tags            text[]  NOT NULL DEFAULT '{}',
    ADD COLUMN requires_report boolean NOT NULL DEFAULT false;

CREATE INDEX issue_tags_idx     ON issue USING gin (tags);
CREATE INDEX issue_template_idx ON issue (template_id) WHERE template_id IS NOT NULL;

-- Every report becomes an action from the Report template.
UPDATE issue SET
    type_id         = (SELECT id FROM issue_type WHERE code = 'action'),
    template_id     = (SELECT id FROM issue_template WHERE tag = 'report'),
    tags            = ARRAY['report'],
    requires_report = true
WHERE type_id = (SELECT id FROM issue_type WHERE code = 'report');

-- Report grants become action grants (the Report template is an action),
-- skipping any the group already holds.
INSERT INTO group_permission (group_id, permission_key, issue_type_id, scope, granted_by, created_at)
SELECT gp.group_id, gp.permission_key, (SELECT id FROM issue_type WHERE code = 'action'), gp.scope, gp.granted_by, gp.created_at
FROM group_permission gp
WHERE gp.issue_type_id = (SELECT id FROM issue_type WHERE code = 'report')
ON CONFLICT ON CONSTRAINT group_permission_uq DO NOTHING;
DELETE FROM group_permission WHERE issue_type_id = (SELECT id FROM issue_type WHERE code = 'report');

-- New branches' "All members" baseline: report becomes action.
CREATE OR REPLACE FUNCTION create_default_group() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    g uuid;
BEGIN
    INSERT INTO user_group (branch_id, name, description, is_default, created_by)
    VALUES (NEW.id, 'All members', 'Everyone in the branch. Holds the baseline permissions.', true, NEW.created_by)
    RETURNING id INTO g;

    INSERT INTO group_permission (group_id, permission_key, issue_type_id, scope)
    SELECT g, b.key, t.id, b.scope::permission_scope
    FROM (VALUES
        ('issue.read',       NULL,     'branch'),
        ('issue.create',     'ticket', 'branch'),
        ('issue.create',     'action', 'branch'),
        ('issue.create',     'event',  'branch'),
        ('issue.edit',       NULL,     'own'),
        ('issue.close',      NULL,     'own'),
        ('issue.target',     'ticket', 'own'),
        ('issue.target',     'event',  'own'),
        ('work_item.update', NULL,     'targeted'),
        ('work_item.assign', NULL,     'targeted'),
        ('comment.create',   NULL,     'branch'),
        ('member.view',      NULL,     'branch')
    ) AS b (key, type_code, scope)
    LEFT JOIN issue_type t ON t.code = b.type_code;

    RETURN NEW;
END;
$$;

DELETE FROM issue_type WHERE code = 'report';
ALTER TABLE issue_type DROP CONSTRAINT issue_type_code_check;
ALTER TABLE issue_type ADD CONSTRAINT issue_type_code_check CHECK (code IN ('ticket', 'event', 'action'));
