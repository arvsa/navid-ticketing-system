//! The school directory: every active branch, its departments (groups other
//! than "All members") and its people, for everyone signed in. Names, emails
//! and who runs what only; bios and pictures come from the profile endpoints.

use std::collections::HashMap;

use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{authz::Actor, error::AppResult};

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DirectoryBranch {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    /// The branch's contact address.
    pub email: Option<String>,
    pub timezone: String,
    pub groups: Vec<DirectoryGroup>,
    pub people: Vec<DirectoryPerson>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DirectoryGroup {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    /// Current, active members.
    pub member_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DirectoryPerson {
    pub user_id: Uuid,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    /// Runs this branch.
    pub is_admin: bool,
}

pub async fn list(db: &PgPool, _actor: &Actor) -> AppResult<Vec<DirectoryBranch>> {
    let branches =
        sqlx::query!("SELECT id, code, name, email::text, timezone FROM branch WHERE is_active ORDER BY name, id")
            .fetch_all(db)
            .await?;
    let mut groups: HashMap<Uuid, Vec<DirectoryGroup>> = HashMap::new();
    for g in sqlx::query!(
        r#"
        SELECT g.id, g.branch_id AS "branch_id!", g.name, g.description,
               ARRAY(SELECT gm.user_id FROM group_member gm
                     JOIN app_user u ON u.id = gm.user_id AND u.is_active
                     JOIN branch_membership m ON m.user_id = gm.user_id AND m.branch_id = g.branch_id
                                             AND m.left_at IS NULL
                     WHERE gm.group_id = g.id
                     ORDER BY u.first_name, u.last_name, u.id) AS "member_ids!"
        FROM user_group g
        WHERE g.branch_id IS NOT NULL AND NOT g.is_default AND g.archived_at IS NULL
        ORDER BY lower(g.name), g.id
        "#
    )
    .fetch_all(db)
    .await?
    {
        groups.entry(g.branch_id).or_default().push(DirectoryGroup {
            id: g.id,
            name: g.name,
            description: g.description,
            member_ids: g.member_ids,
        });
    }
    let mut people: HashMap<Uuid, Vec<DirectoryPerson>> = HashMap::new();
    for p in sqlx::query!(
        r#"
        SELECT m.branch_id, u.id, u.first_name, u.last_name, u.email::text AS "email!", m.is_admin
        FROM branch_membership m JOIN app_user u ON u.id = m.user_id
        WHERE m.left_at IS NULL AND u.is_active
        ORDER BY u.first_name, u.last_name, u.id
        "#
    )
    .fetch_all(db)
    .await?
    {
        people.entry(p.branch_id).or_default().push(DirectoryPerson {
            user_id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            email: p.email,
            is_admin: p.is_admin,
        });
    }
    Ok(branches
        .into_iter()
        .map(|b| DirectoryBranch {
            groups: groups.remove(&b.id).unwrap_or_default(),
            people: people.remove(&b.id).unwrap_or_default(),
            id: b.id,
            code: b.code,
            name: b.name,
            email: b.email,
            timezone: b.timezone,
        })
        .collect())
}
