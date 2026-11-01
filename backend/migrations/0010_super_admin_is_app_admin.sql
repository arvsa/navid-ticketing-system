-- v1.0.0: super admins run the app, not the daily work.
--
-- Items a super admin sent used to be approved, edited and closed by super
-- admins only (`requires_super_admin_approval`). That rule is gone: an item
-- is run by its sender, whoever they are, and its work is approved by the
-- sender or the branch's approvers. The old items are cleared, with
-- everything that hangs off them. (Their attachment files stay on disk until
-- the storage is cleaned by hand.)
--
-- Whole-branch targets were for super admin items only; the app now lets
-- anyone who may send to other branches use them (branch admins always may).

CREATE TEMP TABLE cleared_issue ON COMMIT DROP AS
SELECT id FROM issue WHERE requires_super_admin_approval;

DELETE FROM notification
WHERE issue_id IN (SELECT id FROM cleared_issue)
   OR work_item_id IN (SELECT w.id FROM work_item w WHERE w.issue_id IN (SELECT id FROM cleared_issue));
DELETE FROM issue_attachment WHERE issue_id IN (SELECT id FROM cleared_issue);
DELETE FROM issue_comment WHERE issue_id IN (SELECT id FROM cleared_issue);
DELETE FROM issue_report WHERE issue_id IN (SELECT id FROM cleared_issue);
DELETE FROM event_rsvp WHERE issue_id IN (SELECT id FROM cleared_issue);
DELETE FROM issue_event WHERE issue_id IN (SELECT id FROM cleared_issue);
DELETE FROM work_item WHERE issue_id IN (SELECT id FROM cleared_issue);
DELETE FROM issue_target WHERE issue_id IN (SELECT id FROM cleared_issue);
DELETE FROM issue_watcher WHERE issue_id IN (SELECT id FROM cleared_issue);
DELETE FROM issue_read WHERE issue_id IN (SELECT id FROM cleared_issue);
DELETE FROM issue WHERE id IN (SELECT id FROM cleared_issue);

-- Whole-branch targets: the trigger keeps a branch issue's targets in its
-- branch; who may send to a whole branch is the app's decision.
CREATE OR REPLACE FUNCTION check_issue_target() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    i issue%ROWTYPE;
BEGIN
    SELECT * INTO i FROM issue WHERE id = NEW.issue_id;
    IF i.branch_id IS NOT NULL AND NEW.branch_id <> i.branch_id THEN
        RAISE EXCEPTION 'target branch must match the issue branch';
    END IF;
    RETURN NEW;
END;
$$;

-- issue_overview selects every issue column; rebuild it without this one.
DROP VIEW issue_overview;
ALTER TABLE issue DROP COLUMN requires_super_admin_approval;
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
