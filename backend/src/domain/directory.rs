//! The school directory: every active branch, its departments and its
//! people, for everyone signed in. Names, emails
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
    pub departments: Vec<DirectoryDepartment>,
    pub people: Vec<DirectoryPerson>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DirectoryDepartment {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    /// Current, active members.
    pub member_ids: Vec<Uuid>,
    /// Who runs the department (some of `member_ids`).
    pub head_ids: Vec<Uuid>,
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
    let mut departments: HashMap<Uuid, Vec<DirectoryDepartment>> = HashMap::new();
    for d in sqlx::query!(
        r#"
        SELECT d.id, d.branch_id, d.name, d.description,
               ARRAY(SELECT dm.user_id FROM department_member dm
                     JOIN app_user u ON u.id = dm.user_id AND u.is_active
                     WHERE dm.department_id = d.id
                     ORDER BY u.first_name, u.last_name, u.id) AS "member_ids!",
               ARRAY(SELECT dm.user_id FROM department_member dm WHERE dm.department_id = d.id AND dm.is_head) AS "head_ids!"
        FROM department d
        WHERE NOT d.is_default AND d.archived_at IS NULL
        ORDER BY lower(d.name), d.id
        "#
    )
    .fetch_all(db)
    .await?
    {
        departments.entry(d.branch_id).or_default().push(DirectoryDepartment {
            id: d.id,
            name: d.name,
            description: d.description,
            member_ids: d.member_ids,
            head_ids: d.head_ids,
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
            departments: departments.remove(&b.id).unwrap_or_default(),
            people: people.remove(&b.id).unwrap_or_default(),
            id: b.id,
            code: b.code,
            name: b.name,
            email: b.email,
            timezone: b.timezone,
        })
        .collect())
}
