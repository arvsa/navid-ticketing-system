-- The issue visibility predicate (BACKEND_PLAN.md section 6.5).
--
-- It lives in the database so every list, dashboard and export query can
-- use it from a compile-time-checked `sqlx::query!`:
--
--     WHERE issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
--
-- `f` is built from the request's Actor by src/authz/filter.rs:
--
--     {"me": uuid, "super": bool,
--      "branches":     ["<branch>", ...],               -- current memberships
--      "admin":        ["<branch>", ...],               -- branches where me is admin
--      "read":         ["<branch>:<type|*>", ...],      -- issue.read at branch scope
--      "read_private": ["<branch>:<type|*>", ...]}      -- issue.read_private
--
-- It must agree with authz::policy::can_read; tests enforce this.

CREATE FUNCTION issue_visible(
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
            WHERE t.issue_id = p_issue_id AND (
                   t.user_id = (f->>'me')::uuid
                OR t.group_id IN (SELECT gm.group_id FROM group_member gm WHERE gm.user_id = (f->>'me')::uuid)
                OR (t.kind = 'branch' AND f->'branches' ? t.branch_id::text)))
        -- targeted: assignee of a work item
        OR EXISTS (SELECT 1 FROM work_item w WHERE w.issue_id = p_issue_id AND w.assignee_id = (f->>'me')::uuid)
        -- branch-level access, in the issue's branch or, for a cross-branch
        -- issue, in any branch it targets
        OR EXISTS (
            SELECT 1
            FROM (SELECT p_branch_id AS b WHERE p_branch_id IS NOT NULL
                  UNION
                  SELECT t.branch_id FROM issue_target t
                  WHERE p_branch_id IS NULL AND t.issue_id = p_issue_id) ib
            CROSS JOIN (SELECT code FROM issue_type WHERE id = p_type_id) ty
            WHERE f->'admin' ? ib.b::text
               OR f->'read_private' ?| ARRAY[ib.b::text || ':*', ib.b::text || ':' || ty.code]
               OR (NOT p_is_private AND f->'read' ?| ARRAY[ib.b::text || ':*', ib.b::text || ':' || ty.code]))
$$;
