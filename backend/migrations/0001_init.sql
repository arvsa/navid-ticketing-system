-- School ticketing system schema, v0.0.3
-- Target: PostgreSQL 16+
--
-- Model summary
--   * Branches contain members; a member can belong to several branches.
--   * Admin is a per-branch flag set only by a super admin.
--   * Groups live inside one branch. Admins create them and grant them
--     permissions; members inherit the permissions of their groups.
--   * Every branch has a default "All members" group carrying the baseline.
--   * An issue is sent to targets (a user, a group, or - super admin only - a
--     whole branch). Actions and Reports produce work items that go through
--     submit -> approve. Events produce RSVPs. Tickets are answered in comments.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

CREATE TYPE issue_priority   AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE issue_state      AS ENUM ('open', 'closed', 'cancelled');
CREATE TYPE completion_mode  AS ENUM ('shared', 'per_member');
CREATE TYPE target_kind      AS ENUM ('branch', 'group', 'user');
CREATE TYPE permission_scope AS ENUM ('own', 'targeted', 'branch');
CREATE TYPE rsvp_response    AS ENUM ('pending', 'going', 'maybe', 'declined');

-- open -> in_progress <-> blocked -> pending_approval -> approved
-- pending_approval -> in_progress on rejection; any non-final -> cancelled
CREATE TYPE work_status AS ENUM
    ('open', 'in_progress', 'blocked', 'pending_approval', 'approved', 'cancelled');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE FUNCTION reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 citext      NOT NULL UNIQUE,
    first_name            text        NOT NULL,
    last_name             text        NOT NULL,
    password_hash         text        NOT NULL,           -- argon2id
    is_super_admin        boolean     NOT NULL DEFAULT false,
    is_active             boolean     NOT NULL DEFAULT true,
    must_change_password  boolean     NOT NULL DEFAULT true, -- no email: admins set temp passwords
    failed_login_count    integer     NOT NULL DEFAULT 0,
    locked_until          timestamptz,
    last_login_at         timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_session (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    token_hash    bytea       NOT NULL UNIQUE,            -- sha256 of the cookie token
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    revoked_at    timestamptz,
    user_agent    text,
    ip            inet
);

CREATE INDEX user_session_user_idx ON user_session (user_id);

-- ---------------------------------------------------------------------------
-- Organisation: branches, memberships, groups
-- ---------------------------------------------------------------------------

CREATE TABLE branch (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,10}$'),
    name        text        NOT NULL UNIQUE,
    email       citext,
    timezone    text        NOT NULL DEFAULT 'UTC',       -- IANA name, validated by the API
    is_active   boolean     NOT NULL DEFAULT true,
    created_by  uuid        REFERENCES app_user (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- A user's place in a branch. Rows are never deleted; leaving sets left_at,
-- so history (targets, assignments) keeps pointing at a valid row.
CREATE TABLE branch_membership (
    user_id     uuid        NOT NULL REFERENCES app_user (id),
    branch_id   uuid        NOT NULL REFERENCES branch (id),
    is_admin    boolean     NOT NULL DEFAULT false,       -- set by super admins only
    added_by    uuid        REFERENCES app_user (id),
    joined_at   timestamptz NOT NULL DEFAULT now(),
    left_at     timestamptz,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, branch_id),
    CONSTRAINT branch_membership_admin_active CHECK (NOT (is_admin AND left_at IS NOT NULL))
);

CREATE INDEX branch_membership_branch_idx ON branch_membership (branch_id) WHERE left_at IS NULL;

CREATE TABLE user_group (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id    uuid        NOT NULL REFERENCES branch (id),
    name         text        NOT NULL,
    description  text,
    is_default   boolean     NOT NULL DEFAULT false,      -- the branch's "All members" group
    created_by   uuid        REFERENCES app_user (id),
    archived_at  timestamptz,                             -- groups with history are archived, not deleted
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_group_name_uq UNIQUE (branch_id, name),
    CONSTRAINT user_group_id_branch_uq UNIQUE (id, branch_id),
    CONSTRAINT user_group_default_not_archived CHECK (NOT (is_default AND archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX user_group_one_default ON user_group (branch_id) WHERE is_default;

CREATE TABLE group_member (
    group_id   uuid        NOT NULL,
    user_id    uuid        NOT NULL,
    branch_id  uuid        NOT NULL,
    added_by   uuid        REFERENCES app_user (id),
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id),
    -- the group and the person must both be in the same branch
    FOREIGN KEY (group_id, branch_id) REFERENCES user_group (id, branch_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, branch_id)  REFERENCES branch_membership (user_id, branch_id)
);

CREATE INDEX group_member_user_idx ON group_member (user_id, branch_id);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

CREATE TABLE issue_type (
    id                 smallint    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code               text        NOT NULL UNIQUE
                                   CHECK (code IN ('ticket', 'report', 'event', 'action')),
    name               text        NOT NULL,
    description        text,
    default_sla_hours  integer     CHECK (default_sla_hours > 0),
    is_active          boolean     NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now()
);

-- Catalog of grantable permissions. Mirrors an enum in the Rust code and is
-- only changed by migrations. Admin-only and super-admin-only actions are
-- deliberately absent: they are hard-coded and can never be granted.
CREATE TABLE permission (
    key             text               PRIMARY KEY,
    description     text               NOT NULL,
    per_issue_type  boolean            NOT NULL,          -- may a grant be limited to one issue type?
    allowed_scopes  permission_scope[] NOT NULL
);

CREATE TABLE group_permission (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        uuid             NOT NULL REFERENCES user_group (id) ON DELETE CASCADE,
    permission_key  text             NOT NULL REFERENCES permission (key),
    issue_type_id   smallint         REFERENCES issue_type (id),  -- NULL = all types
    scope           permission_scope NOT NULL,
    granted_by      uuid             REFERENCES app_user (id),
    created_at      timestamptz      NOT NULL DEFAULT now(),
    CONSTRAINT group_permission_uq
        UNIQUE NULLS NOT DISTINCT (group_id, permission_key, issue_type_id, scope)
);

CREATE INDEX group_permission_group_idx ON group_permission (group_id);

-- ---------------------------------------------------------------------------
-- Issues
-- ---------------------------------------------------------------------------

CREATE TABLE issue (
    id                             uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    number                         bigint          GENERATED ALWAYS AS IDENTITY UNIQUE,
    branch_id                      uuid            REFERENCES branch (id), -- NULL = cross-branch (super admin)
    type_id                        smallint        NOT NULL REFERENCES issue_type (id),
    title                          text            NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    description                    text,
    priority                       issue_priority  NOT NULL DEFAULT 'medium',
    is_private                     boolean         NOT NULL DEFAULT false,
    completion_mode                completion_mode NOT NULL DEFAULT 'shared',
    state                          issue_state     NOT NULL DEFAULT 'open',
    closed_at                      timestamptz,
    closed_by                      uuid            REFERENCES app_user (id),
    -- fixed at creation: true when a super admin created it, so later
    -- demotions don't change who approves the work
    requires_super_admin_approval  boolean         NOT NULL DEFAULT false,
    created_by                     uuid            NOT NULL REFERENCES app_user (id),
    version                        integer         NOT NULL DEFAULT 1,
    created_at                     timestamptz     NOT NULL DEFAULT now(),
    updated_at                     timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT issue_closed_at CHECK ((state = 'open') = (closed_at IS NULL)),
    CONSTRAINT issue_cross_branch_is_super CHECK (branch_id IS NOT NULL OR requires_super_admin_approval)
);

CREATE INDEX issue_branch_state_idx ON issue (branch_id, state);
CREATE INDEX issue_created_by_idx   ON issue (created_by);
CREATE INDEX issue_type_idx         ON issue (type_id);
CREATE INDEX issue_created_at_idx   ON issue (created_at DESC);

-- Who an issue is addressed to. branch_id is always filled, even for user and
-- group targets, so every permission filter is a plain branch check.
CREATE TABLE issue_target (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id    uuid        NOT NULL REFERENCES issue (id),
    branch_id   uuid        NOT NULL REFERENCES branch (id),
    kind        target_kind NOT NULL,
    group_id    uuid,
    user_id     uuid,
    created_by  uuid        REFERENCES app_user (id),
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT issue_target_shape CHECK (
        (kind = 'branch' AND group_id IS NULL     AND user_id IS NULL)     OR
        (kind = 'group'  AND group_id IS NOT NULL AND user_id IS NULL)     OR
        (kind = 'user'   AND user_id  IS NOT NULL AND group_id IS NULL)
    ),
    CONSTRAINT issue_target_once UNIQUE NULLS NOT DISTINCT (issue_id, branch_id, group_id, user_id),
    CONSTRAINT issue_target_id_issue_branch_uq UNIQUE (id, issue_id, branch_id),
    FOREIGN KEY (group_id, branch_id) REFERENCES user_group (id, branch_id),
    FOREIGN KEY (user_id, branch_id)  REFERENCES branch_membership (user_id, branch_id)
);

CREATE INDEX issue_target_issue_idx  ON issue_target (issue_id);
CREATE INDEX issue_target_branch_idx ON issue_target (branch_id);
CREATE INDEX issue_target_user_idx   ON issue_target (user_id)  WHERE user_id  IS NOT NULL;
CREATE INDEX issue_target_group_idx  ON issue_target (group_id) WHERE group_id IS NOT NULL;

-- The unit of work for Actions and Reports. 'shared' targets get one item
-- (claimed by a member); 'per_member' targets get one item per member,
-- snapshotted when the issue is sent.
CREATE TABLE work_item (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id       uuid        NOT NULL,
    target_id      uuid        NOT NULL,
    branch_id      uuid        NOT NULL,
    assignee_id    uuid,
    status         work_status NOT NULL DEFAULT 'open',
    sla_due_at     timestamptz,
    submitted_at   timestamptz,                           -- last submission for approval
    decided_by     uuid        REFERENCES app_user (id),  -- last approve/reject
    decided_at     timestamptz,
    decision_note  text,                                  -- required by the API on rejection
    version        integer     NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (target_id, issue_id, branch_id)
        REFERENCES issue_target (id, issue_id, branch_id),
    -- assignee must be a member of the branch the work belongs to
    FOREIGN KEY (assignee_id, branch_id) REFERENCES branch_membership (user_id, branch_id),
    CONSTRAINT work_item_once_per_assignee UNIQUE NULLS NOT DISTINCT (target_id, assignee_id),
    CONSTRAINT work_item_id_issue_uq UNIQUE (id, issue_id),
    CONSTRAINT work_item_submitted CHECK (
        status NOT IN ('pending_approval', 'approved') OR submitted_at IS NOT NULL),
    CONSTRAINT work_item_decided CHECK (status <> 'approved' OR decided_at IS NOT NULL)
);

CREATE INDEX work_item_issue_idx    ON work_item (issue_id);
CREATE INDEX work_item_queue_idx    ON work_item (branch_id, status);
CREATE INDEX work_item_assignee_idx ON work_item (assignee_id, status);
CREATE INDEX work_item_sla_idx      ON work_item (sla_due_at)
    WHERE status IN ('open', 'in_progress', 'blocked');

CREATE TABLE issue_watcher (
    issue_id    uuid        NOT NULL REFERENCES issue (id),
    user_id     uuid        NOT NULL REFERENCES app_user (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (issue_id, user_id)
);

CREATE INDEX issue_watcher_user_idx ON issue_watcher (user_id);

-- Last time a user opened an issue; drives "unread" badges.
CREATE TABLE issue_read (
    user_id       uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    issue_id      uuid        NOT NULL REFERENCES issue (id),
    last_read_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, issue_id)
);

-- ---------------------------------------------------------------------------
-- Collaboration
-- ---------------------------------------------------------------------------

CREATE TABLE issue_comment (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id          uuid        NOT NULL REFERENCES issue (id),
    work_item_id      uuid,                               -- NULL = issue-wide thread
    author_id         uuid        NOT NULL REFERENCES app_user (id),
    body              text        NOT NULL CHECK (length(body) > 0),
    is_internal_only  boolean     NOT NULL DEFAULT false, -- hidden without comment.internal
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz,

    CONSTRAINT issue_comment_id_issue_uq UNIQUE (id, issue_id),
    FOREIGN KEY (work_item_id, issue_id) REFERENCES work_item (id, issue_id)
);

CREATE INDEX issue_comment_issue_idx ON issue_comment (issue_id, created_at);
CREATE INDEX issue_comment_work_idx  ON issue_comment (work_item_id, created_at)
    WHERE work_item_id IS NOT NULL;

CREATE TABLE comment_mention (
    comment_id  uuid NOT NULL REFERENCES issue_comment (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES app_user (id),
    PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE issue_report (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id      uuid        NOT NULL REFERENCES issue (id),
    work_item_id  uuid,                                   -- NULL = a self-filed report
    author_id     uuid        NOT NULL REFERENCES app_user (id),
    title         text        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    body          text        NOT NULL,
    submitted_at  timestamptz,                            -- NULL = draft
    version       integer     NOT NULL DEFAULT 1,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT issue_report_id_issue_uq UNIQUE (id, issue_id),
    FOREIGN KEY (work_item_id, issue_id) REFERENCES work_item (id, issue_id)
);

CREATE INDEX issue_report_issue_idx ON issue_report (issue_id);
CREATE INDEX issue_report_work_idx  ON issue_report (work_item_id) WHERE work_item_id IS NOT NULL;

CREATE TABLE issue_attachment (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id         uuid        NOT NULL REFERENCES issue (id),
    comment_id       uuid,
    report_id        uuid,
    uploaded_by      uuid        NOT NULL REFERENCES app_user (id),
    file_name        text        NOT NULL,
    storage_key      text        NOT NULL UNIQUE,
    content_type     text        NOT NULL,
    file_size_bytes  bigint      NOT NULL CHECK (file_size_bytes >= 0),
    checksum_sha256  char(64)    NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT issue_attachment_single_parent CHECK (num_nonnulls(comment_id, report_id) <= 1),
    FOREIGN KEY (comment_id, issue_id) REFERENCES issue_comment (id, issue_id),
    FOREIGN KEY (report_id, issue_id)  REFERENCES issue_report (id, issue_id)
);

CREATE INDEX issue_attachment_issue_idx   ON issue_attachment (issue_id);
CREATE INDEX issue_attachment_comment_idx ON issue_attachment (comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX issue_attachment_report_idx  ON issue_attachment (report_id)  WHERE report_id  IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

CREATE TABLE issue_event (
    issue_id   uuid        PRIMARY KEY REFERENCES issue (id),
    starts_at  timestamptz NOT NULL,
    ends_at    timestamptz NOT NULL,
    all_day    boolean     NOT NULL DEFAULT false,
    location   text,
    CONSTRAINT issue_event_range CHECK (ends_at >= starts_at)
);

CREATE INDEX issue_event_starts_idx ON issue_event (starts_at);

-- One row per invitee, created from the targets when the event is published.
CREATE TABLE event_rsvp (
    issue_id      uuid          NOT NULL REFERENCES issue_event (issue_id),
    user_id       uuid          NOT NULL REFERENCES app_user (id),
    response      rsvp_response NOT NULL DEFAULT 'pending',
    note          text,
    responded_at  timestamptz,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (issue_id, user_id),
    CONSTRAINT event_rsvp_responded CHECK ((response = 'pending') = (responded_at IS NULL))
);

CREATE INDEX event_rsvp_user_idx ON event_rsvp (user_id);

CREATE TABLE event_reminder (
    issue_id        uuid    NOT NULL REFERENCES issue_event (issue_id) ON DELETE CASCADE,
    minutes_before  integer NOT NULL CHECK (minutes_before BETWEEN 1 AND 40320),  -- up to 4 weeks
    PRIMARY KEY (issue_id, minutes_before)
);

-- ---------------------------------------------------------------------------
-- Notifications and audit
-- ---------------------------------------------------------------------------

CREATE TABLE notification (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_id  uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    kind          text        NOT NULL CHECK (kind IN (
                      'assigned', 'unassigned', 'mentioned', 'commented',
                      'status_changed', 'submitted_for_approval', 'approved', 'rejected',
                      'changed_by_admin', 'ticket_created',
                      'event_invited', 'event_updated', 'event_cancelled', 'event_reminder',
                      'sla_due_soon', 'sla_breached',
                      'added_to_group', 'permissions_changed')),
    branch_id     uuid        REFERENCES branch (id),
    issue_id      uuid        REFERENCES issue (id),
    work_item_id  uuid        REFERENCES work_item (id),
    actor_id      uuid        REFERENCES app_user (id),   -- NULL = system job
    payload       jsonb       NOT NULL DEFAULT '{}',
    dedupe_key    text        UNIQUE,                     -- e.g. 'reminder:<issue>:<user>:60'
    created_at    timestamptz NOT NULL DEFAULT now(),
    read_at       timestamptz
);

CREATE INDEX notification_inbox_idx  ON notification (recipient_id, created_at DESC);
CREATE INDEX notification_unread_idx ON notification (recipient_id) WHERE read_at IS NULL;

CREATE TABLE audit_log (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type  text        NOT NULL,   -- 'issue', 'work_item', 'branch_membership', 'group_permission', 'export', ...
    entity_id    text        NOT NULL,
    branch_id    uuid        REFERENCES branch (id),
    actor_id     uuid        REFERENCES app_user (id),    -- NULL = system job
    action       text        NOT NULL,   -- 'create', 'update', 'approve', 'grant', 'revoke', 'export', ...
    old_value    jsonb,
    new_value    jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at);
CREATE INDEX audit_log_branch_idx ON audit_log (branch_id, created_at);
CREATE INDEX audit_log_actor_idx  ON audit_log (actor_id, created_at);

CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- Every new branch gets an "All members" group with the baseline permissions.
CREATE FUNCTION create_default_group() RETURNS trigger
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
        ('issue.create',     'report', 'branch'),
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

CREATE TRIGGER branch_default_group
    AFTER INSERT ON branch
    FOR EACH ROW EXECUTE FUNCTION create_default_group();

-- Joining a branch puts you in its "All members" group; leaving removes you
-- from every group in that branch.
CREATE FUNCTION sync_default_group_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.left_at IS NULL AND (TG_OP = 'INSERT' OR OLD.left_at IS NOT NULL) THEN
        INSERT INTO group_member (group_id, user_id, branch_id, added_by)
        SELECT g.id, NEW.user_id, NEW.branch_id, NEW.added_by
        FROM user_group g
        WHERE g.branch_id = NEW.branch_id AND g.is_default
        ON CONFLICT DO NOTHING;
    ELSIF NEW.left_at IS NOT NULL AND TG_OP = 'UPDATE' AND OLD.left_at IS NULL THEN
        DELETE FROM group_member WHERE user_id = NEW.user_id AND branch_id = NEW.branch_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER branch_membership_default_group
    AFTER INSERT OR UPDATE OF left_at ON branch_membership
    FOR EACH ROW EXECUTE FUNCTION sync_default_group_membership();

-- Only current branch members can be added to a group.
CREATE FUNCTION check_group_member_active() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM branch_membership
               WHERE user_id = NEW.user_id AND branch_id = NEW.branch_id AND left_at IS NOT NULL) THEN
        RAISE EXCEPTION 'user % has left branch %', NEW.user_id, NEW.branch_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER group_member_active
    BEFORE INSERT ON group_member
    FOR EACH ROW EXECUTE FUNCTION check_group_member_active();

-- The "All members" group can't be deleted or demoted.
CREATE FUNCTION protect_default_group() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.is_default THEN
        RAISE EXCEPTION 'the default group cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.is_default <> NEW.is_default THEN
        RAISE EXCEPTION 'is_default cannot be changed';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER user_group_protect_default
    BEFORE UPDATE OR DELETE ON user_group
    FOR EACH ROW EXECUTE FUNCTION protect_default_group();

-- A grant must use a scope the permission allows, and may only name an issue
-- type when the permission is per-type.
CREATE FUNCTION check_group_permission() RETURNS trigger
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
    RETURN NEW;
END;
$$;

CREATE TRIGGER group_permission_valid
    BEFORE INSERT OR UPDATE ON group_permission
    FOR EACH ROW EXECUTE FUNCTION check_group_permission();

-- Targets of a branch issue stay in that branch; whole-branch targets are for
-- super admin issues only.
CREATE FUNCTION check_issue_target() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    i issue%ROWTYPE;
BEGIN
    SELECT * INTO i FROM issue WHERE id = NEW.issue_id;
    IF i.branch_id IS NOT NULL AND NEW.branch_id <> i.branch_id THEN
        RAISE EXCEPTION 'target branch must match the issue branch';
    END IF;
    IF NEW.kind = 'branch' AND NOT i.requires_super_admin_approval THEN
        RAISE EXCEPTION 'only super admin issues can target a whole branch';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER issue_target_valid
    BEFORE INSERT OR UPDATE ON issue_target
    FOR EACH ROW EXECUTE FUNCTION check_issue_target();

-- Every active branch keeps at least one admin. Deferred so a branch and its
-- first admin can be created, or admins swapped, in one transaction. The API
-- also locks the branch row (SELECT ... FOR UPDATE) before demoting, so two
-- concurrent demotions can't both pass.
CREATE FUNCTION assert_branch_has_admin(b uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM branch WHERE id = b AND is_active)
       AND NOT EXISTS (SELECT 1 FROM branch_membership m
                       JOIN app_user u ON u.id = m.user_id
                       WHERE m.branch_id = b AND m.is_admin AND m.left_at IS NULL AND u.is_active) THEN
        RAISE EXCEPTION 'branch % must have at least one active admin', b;
    END IF;
END;
$$;

CREATE FUNCTION check_branch_has_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM assert_branch_has_admin(NEW.id);
    RETURN NULL;
END;
$$;

CREATE FUNCTION check_membership_keeps_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM assert_branch_has_admin(OLD.branch_id);
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER branch_needs_admin
    AFTER INSERT OR UPDATE OF is_active ON branch
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_branch_has_admin();

CREATE CONSTRAINT TRIGGER branch_membership_keeps_admin
    AFTER UPDATE OR DELETE ON branch_membership
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_membership_keeps_admin();

-- Deactivating a user must not leave one of their branches without an admin.
CREATE FUNCTION check_user_deactivation_keeps_admins() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM branch_membership m
        JOIN branch b ON b.id = m.branch_id AND b.is_active
        WHERE m.user_id = NEW.id AND m.is_admin AND m.left_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM branch_membership o
                          JOIN app_user ou ON ou.id = o.user_id
                          WHERE o.branch_id = m.branch_id AND o.is_admin
                            AND o.left_at IS NULL AND ou.is_active)) THEN
        RAISE EXCEPTION 'deactivating this user leaves a branch without an admin';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER app_user_keeps_branch_admins
    AFTER UPDATE OF is_active ON app_user
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_user_deactivation_keeps_admins();

-- There is always at least one active super admin once any user exists.
CREATE FUNCTION check_super_admin_exists() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM app_user)
       AND NOT EXISTS (SELECT 1 FROM app_user WHERE is_super_admin AND is_active) THEN
        RAISE EXCEPTION 'at least one active super admin is required';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER app_user_keeps_super_admin
    AFTER INSERT OR UPDATE OF is_super_admin, is_active OR DELETE ON app_user
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_super_admin_exists();

-- updated_at maintenance
CREATE TRIGGER app_user_updated_at          BEFORE UPDATE ON app_user          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER branch_updated_at            BEFORE UPDATE ON branch            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER branch_membership_updated_at BEFORE UPDATE ON branch_membership FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_group_updated_at        BEFORE UPDATE ON user_group        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER issue_updated_at             BEFORE UPDATE ON issue             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_item_updated_at         BEFORE UPDATE ON work_item         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER issue_comment_updated_at     BEFORE UPDATE ON issue_comment     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER issue_report_updated_at      BEFORE UPDATE ON issue_report      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Derived views
-- ---------------------------------------------------------------------------

CREATE VIEW work_item_overview AS
SELECT w.*,
       coalesce(w.sla_due_at < now()
                AND w.status IN ('open', 'in_progress', 'blocked'), false) AS is_overdue
FROM work_item w;

CREATE VIEW issue_overview AS
SELECT i.*,
       count(w.id)                                                    AS work_item_count,
       count(w.id) FILTER (WHERE w.status IN ('approved', 'cancelled')) AS done_count,
       count(w.id) FILTER (WHERE w.status = 'pending_approval')       AS awaiting_approval_count,
       coalesce(bool_or(w.sla_due_at < now()
                        AND w.status IN ('open', 'in_progress', 'blocked')), false) AS is_overdue,
       min(w.sla_due_at) FILTER (WHERE w.status IN ('open', 'in_progress', 'blocked')) AS next_sla_due_at
FROM issue i
LEFT JOIN work_item w ON w.issue_id = i.id
GROUP BY i.id;

-- ---------------------------------------------------------------------------
-- Seed data (catalogs only)
-- ---------------------------------------------------------------------------

INSERT INTO issue_type (code, name, description, default_sla_hours) VALUES
    ('ticket', 'Ticket', 'A question or request, answered in comments', NULL),
    ('report', 'Report', 'A written report, submitted for approval when assigned', 168),
    ('event',  'Event',  'A calendar entry with invitees, RSVPs and reminders', NULL),
    ('action', 'Action', 'A task assigned to people or groups, submitted for approval', 72);

INSERT INTO permission (key, description, per_issue_type, allowed_scopes) VALUES
    ('issue.read',          'View issues (private ones need issue.read_private unless you created or are targeted by them)', true,  '{own,targeted,branch}'),
    ('issue.read_private',  'View private issues in the branch',                          true,  '{branch}'),
    ('issue.create',        'Create issues of this type in the branch',                   true,  '{branch}'),
    ('issue.edit',          'Edit title, description, priority and event details',        true,  '{own,branch}'),
    ('issue.close',         'Close or cancel issues',                                     true,  '{own,branch}'),
    ('issue.set_private',   'Mark issues private or public',                              true,  '{own,branch}'),
    ('issue.target',        'Send issues to people and groups in the branch',             true,  '{own,branch}'),
    ('work_item.update',    'Change the status of work and submit it for approval',       true,  '{targeted,branch}'),
    ('work_item.assign',    'Assign, reassign or claim work',                             true,  '{targeted,branch}'),
    ('work_item.approve',   'Approve or reject submitted work (never super admin issues)', true, '{branch}'),
    ('comment.create',      'Comment on issues you can read',                             false, '{targeted,branch}'),
    ('comment.internal',    'Read and write staff-only comments',                         false, '{branch}'),
    ('comment.moderate',    'Delete other people''s comments',                            false, '{branch}'),
    ('member.view',         'See the branch member directory',                            false, '{branch}'),
    ('member.manage',       'Add and remove non-admin members, edit their profiles, reset passwords', false, '{branch}'),
    ('dashboard.branch',    'See the branch-wide dashboard',                              false, '{branch}'),
    ('export.run',          'Export branch data to Excel',                                false, '{branch}');

COMMIT;
