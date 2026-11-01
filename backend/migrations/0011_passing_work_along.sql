-- Passing work along, and muting an item's updates.
--
-- `handoff_chain`: everyone a work item was passed through, from the person
-- it was first given to, down to the one holding it now (`assignee_id`).
-- Empty until it's first passed. A hand-in is reviewed one level up the
-- chain; at the top (or with no chain) by the item's sender and the branch's
-- approvers. Assigning or claiming starts the chain again. Every pass is in
-- the audit log (`work_item` / `pass`).
--
-- `issue_mute`: people who don't want an item's updates (comments, changes).
-- What needs them (a hand-in to review, work given to them, a mention) still
-- reaches them.

ALTER TABLE work_item ADD COLUMN handoff_chain uuid[] NOT NULL DEFAULT '{}';

-- work_item_overview selects every work_item column: rebuild it with the new one.
DROP VIEW work_item_overview;
CREATE VIEW work_item_overview AS
SELECT w.*,
       coalesce(w.sla_due_at < now()
                AND w.status IN ('open', 'in_progress', 'blocked'), false) AS is_overdue
FROM work_item w;

CREATE TABLE issue_mute (
    issue_id    uuid        NOT NULL REFERENCES issue (id),
    user_id     uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (issue_id, user_id)
);

-- Who reviews a hand-in next: the person one level up the chain from the
-- holder, or NULL for the item's usual approvers.
CREATE FUNCTION work_reviewer(chain uuid[], holder uuid) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN array_position(chain, holder) > 1 THEN chain[array_position(chain, holder) - 1] END
$$;
