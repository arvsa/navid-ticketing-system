-- Allow several unassigned work items on one target.
--
-- 0001 declared UNIQUE NULLS NOT DISTINCT (target_id, assignee_id), which
-- permits only one unassigned item per target. When members leave a branch
-- their open items become unassigned (BACKEND_PLAN.md 7.1); with a
-- per_member target, the second departure would violate that constraint.
--
-- Plain UNIQUE treats NULLs as distinct: still at most one item per assignee
-- per target, but any number of unassigned ones. The domain code keeps
-- creating exactly one unassigned item for a shared target.

ALTER TABLE work_item DROP CONSTRAINT work_item_once_per_assignee;
ALTER TABLE work_item ADD CONSTRAINT work_item_once_per_assignee UNIQUE (target_id, assignee_id);
