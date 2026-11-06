-- Private issues are gone. Issues still marked private are deleted with
-- everything attached to them (their attachment files stay on disk);
-- `issue.read_private` and `issue.set_private` leave the catalog, and
-- `issue_visible` loses its `p_is_private` argument.

CREATE TEMP TABLE gone_issue ON COMMIT DROP AS SELECT id FROM issue WHERE is_private;

DELETE FROM notification
WHERE issue_id IN (SELECT id FROM gone_issue)
   OR work_item_id IN (SELECT id FROM work_item WHERE issue_id IN (SELECT id FROM gone_issue));
DELETE FROM issue_attachment WHERE issue_id IN (SELECT id FROM gone_issue);
DELETE FROM issue_comment    WHERE issue_id IN (SELECT id FROM gone_issue);  -- mentions cascade
DELETE FROM issue_report     WHERE issue_id IN (SELECT id FROM gone_issue);
DELETE FROM event_rsvp       WHERE issue_id IN (SELECT id FROM gone_issue);
DELETE FROM issue_event      WHERE issue_id IN (SELECT id FROM gone_issue);  -- reminders cascade
DELETE FROM work_item        WHERE issue_id IN (SELECT id FROM gone_issue);
DELETE FROM issue_target     WHERE issue_id IN (SELECT id FROM gone_issue);
DELETE FROM issue_watcher    WHERE issue_id IN (SELECT id FROM gone_issue);
DELETE FROM issue_read       WHERE issue_id IN (SELECT id FROM gone_issue);
DELETE FROM issue_mute       WHERE issue_id IN (SELECT id FROM gone_issue);
DELETE FROM issue            WHERE id IN (SELECT id FROM gone_issue);

DELETE FROM group_permission WHERE permission_key IN ('issue.read_private', 'issue.set_private');
DELETE FROM permission       WHERE key IN ('issue.read_private', 'issue.set_private');
UPDATE permission SET description = 'View issues' WHERE key = 'issue.read';

DROP FUNCTION issue_visible(uuid, uuid, smallint, boolean, uuid, jsonb);
CREATE FUNCTION issue_visible(
    p_issue_id   uuid,
    p_branch_id  uuid,
    p_type_id    smallint,
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
               OR f->'read' ?| ARRAY[ib.b::text || ':*', ib.b::text || ':' || ty.code])
$$;

-- issue_overview selects every issue column; rebuild it without this one.
DROP VIEW issue_overview;
ALTER TABLE issue DROP COLUMN is_private;
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
