-- Leaving a branch ends all access to it (BACKEND_PLAN.md 6.6: "Set
-- left_at. They lose access to that branch."). The "own", user-target and
-- assignee paths of 0004 didn't check membership, so a departed member could
-- still read issues they created, were addressed to, or had worked on.
-- Group targets and branch targets already required a current membership.

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
        -- own, while still a member of the issue's branch
        OR (p_created_by = (f->>'me')::uuid AND (p_branch_id IS NULL OR f->'branches' ? p_branch_id::text))
        -- targeted: user target or branch target (in a current branch), current member of a group target
        OR EXISTS (
            SELECT 1 FROM issue_target t
            WHERE t.issue_id = p_issue_id AND t.removed_at IS NULL AND (
                   (t.user_id = (f->>'me')::uuid AND f->'branches' ? t.branch_id::text)
                OR t.group_id IN (SELECT gm.group_id FROM group_member gm WHERE gm.user_id = (f->>'me')::uuid)
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
               OR f->'read_private' ?| ARRAY[ib.b::text || ':*', ib.b::text || ':' || ty.code]
               OR (NOT p_is_private AND f->'read' ?| ARRAY[ib.b::text || ':*', ib.b::text || ':' || ty.code]))
$$;
