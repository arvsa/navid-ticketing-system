//! Demo data: `cargo run --bin admin -- seed-demo`.
//!
//! Three branches of about 30 people each, groups with grants, and a few
//! hundred issues of every type in various states, created through the
//! domain layer (so through authorization) wherever practical. Every demo
//! account uses [`DEMO_PASSWORD`] and doesn't have to change it.
//!
//! Refuses to run when any branch exists, so it can't touch real data.

use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{
    auth::password::{self, Password},
    authz::Actor,
    domain::{
        comments::{self, NewComment},
        events::{self, RsvpInput, RsvpResponse},
        issues::{self, EventDetails, EventInput, NewIssue},
        targets::TargetInput,
        types::{CompletionMode, Priority},
        work_items::{self, Transition, TransitionInput},
    },
    error::{AppError, AppResult},
};

pub const DEMO_PASSWORD: &str = "demo-password";
pub const DEMO_SUPER_ADMIN: &str = "superadmin@demo.school";
pub const MEMBERS_PER_BRANCH: usize = 28;

#[derive(Debug, Default)]
pub struct Seeded {
    pub branches: usize,
    pub users: usize,
    pub issues: usize,
}

struct Branch {
    id: Uuid,
    code: &'static str,
    admin: Uuid,
    deputy: Uuid,
    members: Vec<Uuid>,
    teachers: Uuid,
}

pub async fn demo(db: &PgPool) -> AppResult<Seeded> {
    let has_branches = sqlx::query_scalar!(r#"SELECT EXISTS (SELECT 1 FROM branch) AS "e!""#).fetch_one(db).await?;
    if has_branches {
        return Err(AppError::conflict("not_empty", "the database already has branches; seed only an empty one"));
    }
    let hash = password::hash_async(Password::new(DEMO_PASSWORD)).await?;
    let mut seeded = Seeded::default();

    let root = user(db, &hash, DEMO_SUPER_ADMIN, "Sam", "Superadmin", true).await?;
    seeded.users += 1;
    let root_actor = actor(db, root).await?;

    let mut branches = Vec::new();
    for (code, name, tz) in [
        ("NORTH", "North Campus", "Europe/London"),
        ("SOUTH", "South Campus", "Europe/London"),
        ("EAST", "East Campus", "Asia/Dubai"),
    ] {
        let lower = code.to_lowercase();
        let admin =
            user(db, &hash, &format!("admin@{lower}.demo.school"), "Alex", &format!("Admin {name}"), false).await?;
        let deputy =
            user(db, &hash, &format!("deputy@{lower}.demo.school"), "Dana", &format!("Deputy {name}"), false).await?;
        let mut tx = db.begin().await?;
        let id = sqlx::query_scalar!(
            "INSERT INTO branch (code, name, timezone, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
            code,
            name,
            tz,
            root
        )
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query!("INSERT INTO branch_membership (user_id, branch_id, is_admin) VALUES ($1, $2, true)", admin, id)
            .execute(&mut *tx)
            .await?;
        sqlx::query!("INSERT INTO branch_membership (user_id, branch_id) VALUES ($1, $2)", deputy, id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        let mut members = Vec::new();
        for n in 1..=MEMBERS_PER_BRANCH {
            let m = user(
                db,
                &hash,
                &format!("member{n}@{lower}.demo.school"),
                FIRST[n % FIRST.len()],
                LAST[n % LAST.len()],
                false,
            )
            .await?;
            sqlx::query!("INSERT INTO branch_membership (user_id, branch_id) VALUES ($1, $2)", m, id)
                .execute(db)
                .await?;
            members.push(m);
        }
        seeded.users += members.len() + 2;

        // Groups: teachers may create actions; the deputies hold every grant.
        let teachers =
            group(db, id, "Teachers", &[("issue.create", Some("action")), ("issue.target", None)], &members[..12])
                .await?;
        group(
            db,
            id,
            "Office",
            &[("member.manage", None), ("dashboard.branch", None), ("export.run", None)],
            &members[12..16],
        )
        .await?;
        group(db, id, "Maintenance", &[("work_item.approve", Some("action"))], &members[16..20]).await?;
        let everything: Vec<(&str, Option<&str>)> =
            crate::authz::Permission::ALL.iter().map(|p| (p.key(), None)).collect();
        group(db, id, "Deputies", &everything, &[deputy]).await?;
        branches.push(Branch { id, code, admin, deputy, members, teachers });
        seeded.branches += 1;
    }

    let now = OffsetDateTime::now_utc();
    for b in &branches {
        let admin = actor(db, b.admin).await?;
        let deputy = actor(db, b.deputy).await?;

        // Tickets from members, some answered, some closed, a few private.
        for n in 0..24 {
            let author = actor(db, b.members[n % b.members.len()]).await?;
            let private = n % 8 == 0;
            let who = if private { &deputy } else { &author };
            let issue = issues::create(
                db,
                who,
                new_issue(b.id, "ticket", &format!("{} ({})", TICKETS[n % TICKETS.len()], b.code), private, vec![]),
            )
            .await?;
            seeded.issues += 1;
            if n % 2 == 0 {
                comments::create(db, &admin, issue.id, comment("Thanks, we're looking into it.", false)).await?;
            }
            if n % 5 == 0 {
                comments::create(db, &admin, issue.id, comment("Staff: needs a part ordered.", true)).await?;
            }
            if n % 3 == 0 {
                issues::close(db, who, issue.id, issue.version, crate::domain::types::IssueState::Closed).await?;
            }
        }

        // Actions: for one person, shared with the teachers, or per teacher.
        for n in 0..12 {
            let (targets, mode) = match n % 3 {
                0 => (vec![target_user(b.members[n + 1])], CompletionMode::Shared),
                1 => (vec![target_group(b.teachers)], CompletionMode::Shared),
                _ => (vec![target_group(b.teachers)], CompletionMode::PerMember),
            };
            let mut input =
                new_issue(b.id, "action", &format!("{} ({})", ACTIONS[n % ACTIONS.len()], b.code), false, targets);
            input.completion_mode = mode;
            input.sla_due_at = Some(now + Duration::hours([-20, 6, 30, 72, 200][n % 5]));
            let issue = issues::create(db, &admin, input).await?;
            seeded.issues += 1;
            // Move some work along: started, submitted, approved.
            for (i, item) in issue.work_items.iter().enumerate().take(4) {
                let Some(assignee) = item.assignee_id else { continue };
                let worker = actor(db, assignee).await?;
                let step = (n + i) % 4;
                let mut version = item.version;
                if step >= 1 {
                    version = work_items::transition(db, &worker, item.id, Transition::Start, transition(version))
                        .await?
                        .version;
                }
                if step >= 2 {
                    version = work_items::transition(db, &worker, item.id, Transition::Submit, transition(version))
                        .await?
                        .version;
                }
                if step >= 3 {
                    work_items::transition(db, &admin, item.id, Transition::Approve, transition(version)).await?;
                }
            }
        }

        // Upcoming events with invitations and some answers.
        for n in 0..6 {
            let start = now + Duration::days(1 + 3 * n as i64) + Duration::hours(9);
            let mut input = new_issue(
                b.id,
                "event",
                &format!("{} ({})", EVENTS[n % EVENTS.len()], b.code),
                false,
                vec![target_group(b.teachers)],
            );
            input.event = Some(EventInput {
                details: EventDetails {
                    starts_at: start,
                    ends_at: start + Duration::hours(2),
                    all_day: false,
                    location: Some("Main hall".into()),
                },
                reminders: None,
            });
            let issue = issues::create(db, &deputy, input).await?;
            seeded.issues += 1;
            for (i, m) in b.members[..12].iter().enumerate() {
                let response = match (i + n) % 4 {
                    0 => RsvpResponse::Going,
                    1 => RsvpResponse::Maybe,
                    2 => RsvpResponse::Declined,
                    _ => continue,
                };
                events::respond(db, &actor(db, *m).await?, issue.id, RsvpInput { response, note: None }).await?;
            }
        }

        // A few reports filed by members for themselves.
        for n in 0..4 {
            let author = actor(db, b.members[20 + n]).await?;
            issues::create(
                db,
                &author,
                new_issue(b.id, "report", &format!("Incident report {} ({})", n + 1, b.code), false, vec![]),
            )
            .await?;
            seeded.issues += 1;
        }
    }

    // One announcement from head office to every branch.
    let mut all = new_issue(Uuid::nil(), "action", "Confirm fire drill procedures", false, vec![]);
    all.branch_id = None;
    all.targets =
        branches.iter().map(|b| TargetInput { user_id: None, group_id: None, branch_id: Some(b.id) }).collect();
    issues::create(db, &root_actor, all).await?;
    seeded.issues += 1;

    Ok(seeded)
}

async fn user(db: &PgPool, hash: &str, email: &str, first: &str, last: &str, super_admin: bool) -> AppResult<Uuid> {
    Ok(sqlx::query_scalar!(
        r#"INSERT INTO app_user (email, first_name, last_name, password_hash, is_super_admin, must_change_password)
           VALUES ($1::text, $2, $3, $4, $5, false) RETURNING id"#,
        email,
        first,
        last,
        hash,
        super_admin
    )
    .fetch_one(db)
    .await?)
}

async fn group(
    db: &PgPool,
    branch: Uuid,
    name: &str,
    grants: &[(&str, Option<&str>)],
    members: &[Uuid],
) -> AppResult<Uuid> {
    let id = sqlx::query_scalar!("INSERT INTO user_group (branch_id, name) VALUES ($1, $2) RETURNING id", branch, name)
        .fetch_one(db)
        .await?;
    for (key, ty) in grants {
        sqlx::query!(
            r#"INSERT INTO group_permission (group_id, permission_key, issue_type_id, scope)
               VALUES ($1, $2, (SELECT id FROM issue_type WHERE code = $3), 'branch')"#,
            id,
            key,
            *ty
        )
        .execute(db)
        .await?;
    }
    for m in members {
        sqlx::query!("INSERT INTO group_member (group_id, user_id, branch_id) VALUES ($1, $2, $3)", id, m, branch)
            .execute(db)
            .await?;
    }
    Ok(id)
}

async fn actor(db: &PgPool, user_id: Uuid) -> AppResult<Actor> {
    let is_super =
        sqlx::query_scalar!("SELECT is_super_admin FROM app_user WHERE id = $1", user_id).fetch_one(db).await?;
    Actor::load(db, user_id, is_super).await
}

fn new_issue(branch: Uuid, ty: &str, title: &str, private: bool, targets: Vec<TargetInput>) -> NewIssue {
    NewIssue {
        branch_id: Some(branch),
        issue_type: ty.to_owned(),
        title: title.to_owned(),
        description: Some(format!("Demo {ty}.")),
        priority: Priority::Medium,
        is_private: private,
        completion_mode: CompletionMode::Shared,
        targets,
        sla_due_at: None,
        event: None,
    }
}

fn target_user(id: Uuid) -> TargetInput {
    TargetInput { user_id: Some(id), group_id: None, branch_id: None }
}

fn target_group(id: Uuid) -> TargetInput {
    TargetInput { user_id: None, group_id: Some(id), branch_id: None }
}

fn comment(body: &str, internal: bool) -> NewComment {
    NewComment { body: body.to_owned(), work_item_id: None, is_internal_only: internal, mention_user_ids: vec![] }
}

fn transition(version: i32) -> TransitionInput {
    TransitionInput { version, note: Some("Looks good".to_owned()), assignee_id: None }
}

const FIRST: &[&str] = &["Ana", "Ben", "Chloe", "Dev", "Eli", "Fatima", "Gus", "Hana", "Ivan", "Jo", "Kai", "Lena"];
const LAST: &[&str] =
    &["Okafor", "Silva", "Nguyen", "Kowalski", "Haddad", "Brown", "Ivanova", "Park", "Rossi", "Meyer"];
const TICKETS: &[&str] = &[
    "Projector in room 12 flickers",
    "Wi-Fi drops in the library",
    "Need a new whiteboard marker set",
    "Heating not working in block B",
    "Printer jammed again",
    "Request: extra chairs for assembly",
    "Locker 42 won't open",
    "Email signature setup",
];
const ACTIONS: &[&str] = &[
    "Submit term grades",
    "Update the risk assessment",
    "Check first-aid kits",
    "Prepare the parents' newsletter",
    "Review the timetable",
];
const EVENTS: &[&str] = &["Staff meeting", "Parents' evening", "Sports day", "Training: safeguarding", "Open day"];
