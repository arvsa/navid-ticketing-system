-- Removing a target (BACKEND_PLAN.md 7.2) cancels its work items but never
-- deletes them, and work_item.target_id references the target, so targets
-- are marked removed instead of deleted.

ALTER TABLE issue_target
    ADD COLUMN removed_at timestamptz,
    ADD COLUMN removed_by uuid REFERENCES app_user (id);

-- A target is unique among the *active* targets of an issue, so a removed
-- target can be added again (as a new row, with new work items).
ALTER TABLE issue_target DROP CONSTRAINT issue_target_once;
CREATE UNIQUE INDEX issue_target_once ON issue_target (issue_id, branch_id, group_id, user_id) NULLS NOT DISTINCT
    WHERE removed_at IS NULL;

-- Same predicate as 0002, ignoring removed targets: being targeted (directly,
-- or as the assignee of that target's work) ends when the target is removed.
CREATE OR REPLACE FUNCTION issue_visible(
    p_issue_id   uuid,
    p_branch_id  uuid,
    p_type_id    smallint,
    p_is_private boolean,
    p_created_by uuid,
    f            jsonb
) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT
        coalesce((f->>'super')::boolean, false)
        -- own
        OR p_created_by = (f->>'me')::uuid
        -- targeted: user target, current member of a group target, member of a branch target
        OR EXISTS (
            SELECT 1 FROM issue_target t
            WHERE t.issue_id = p_issue_id AND t.removed_at IS NULL AND (
                   t.user_id = (f->>'me')::uuid
                OR t.group_id IN (SELECT gm.group_id FROM group_member gm WHERE gm.user_id = (f->>'me')::uuid)
                OR (t.kind = 'branch' AND f->'branches' ? t.branch_id::text)))
        -- targeted: assignee of a work item of an active target
        OR EXISTS (
            SELECT 1 FROM work_item w JOIN issue_target t ON t.id = w.target_id
            WHERE w.issue_id = p_issue_id AND w.assignee_id = (f->>'me')::uuid AND t.removed_at IS NULL)
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
               OR f->'read_private' ?| ARRAY[ib.b::text || ':*', ib.b::text || ':' || ty.code]
               OR (NOT p_is_private AND f->'read' ?| ARRAY[ib.b::text || ':*', ib.b::text || ':' || ty.code]))
$$;
