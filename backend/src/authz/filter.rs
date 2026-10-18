//! List filtering (section 6.5).
//!
//! The predicate itself is the SQL function `issue_visible` (migration 0002),
//! so queries stay compile-time checked. This module turns the Actor into its
//! single `jsonb` argument. Every issue list, search, dashboard and export
//! query must filter with:
//!
//! ```sql
//! WHERE issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $n)
//! ```
//!
//! binding `IssueFilter::for_actor(actor).into_json()` as `$n`.

use serde_json::{json, Value};

use super::{Actor, Permission, Scope};

pub struct IssueFilter(Value);

impl IssueFilter {
    pub fn for_actor(actor: &Actor) -> Self {
        let mut branches = Vec::new();
        let mut admin = Vec::new();
        let mut read = Vec::new();
        let mut read_private = Vec::new();
        let mut internal = Vec::new();

        for (branch_id, access) in &actor.branches {
            let b = branch_id.to_string();
            branches.push(b.clone());
            if access.is_admin {
                admin.push(b.clone());
                internal.push(b.clone());
            }
            for grant in access.grants.iter().filter(|g| g.scope == Scope::Branch) {
                let pair = format!("{b}:{}", grant.issue_type.map_or("*", |t| t.code()));
                match grant.permission {
                    Permission::IssueRead => read.push(pair),
                    Permission::IssueReadPrivate => read_private.push(pair),
                    Permission::CommentInternal if !access.is_admin => internal.push(b.clone()),
                    _ => {}
                }
            }
        }

        Self(json!({
            "me": actor.user_id,
            "super": actor.is_super_admin,
            "branches": branches,
            "admin": admin,
            "read": read,
            "read_private": read_private,
            // Branches where internal comments are visible (admin or comment.internal).
            "internal": internal,
        }))
    }

    pub fn into_json(self) -> Value {
        self.0
    }
}
