-- Sending items to people in other branches. School-wide items used to go
-- to whole branches only (super admins). Holders of this permission, in any
-- branch, may send a school-wide item to chosen people anywhere; whole
-- branches stay super-admin only. Not part of any baseline: groups get it
-- only when an admin grants it.

INSERT INTO permission (key, description, per_issue_type, allowed_scopes) VALUES
    ('issue.target_other_branches', 'Send items to people in other branches', true, '{branch}');

-- Such items are not super admin issues: each branch approves its own work.
ALTER TABLE issue DROP CONSTRAINT issue_cross_branch_is_super;
