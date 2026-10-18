mod common;

use axum::http::StatusCode;
use backend::{
    db::{self, MIGRATOR},
    error::AppError,
};
use common::TestApp;
use sqlx::PgPool;

#[sqlx::test(migrator = "MIGRATOR")]
async fn healthz_checks_the_database(pool: PgPool) {
    let app = TestApp::new(pool);
    let res = app.get("/api/healthz").await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.body["status"], "ok");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn unknown_route_uses_the_error_shape(pool: PgPool) {
    let app = TestApp::new(pool);
    let res = app.get("/api/nope").await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(res.error_code(), Some("not_found"));
    assert!(res.body["error"]["message"].is_string());
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn init_migration_seeds_catalogs(pool: PgPool) {
    let types = sqlx::query_scalar!("SELECT code FROM issue_type ORDER BY code").fetch_all(&pool).await.unwrap();
    assert_eq!(types, ["action", "event", "report", "ticket"]);

    let permissions = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM permission"#).fetch_one(&pool).await.unwrap();
    assert_eq!(permissions, 17);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn migrations_are_idempotent(pool: PgPool) {
    // sqlx::test already applied them; running again must be a no-op.
    db::migrate(&pool).await.unwrap();
}

/// The deferred "at least one super admin" trigger fires at commit and must
/// surface as a readable 409, not raw SQL.
#[sqlx::test(migrator = "MIGRATOR")]
async fn trigger_exceptions_map_to_readable_codes(pool: PgPool) {
    let result = db::with_tx(&pool, |tx| {
        Box::pin(async move {
            sqlx::query!(
                "INSERT INTO app_user (email, first_name, last_name, password_hash) VALUES ($1, $2, $3, $4)",
                "plain@example.com",
                "Plain",
                "User",
                "x",
            )
            .execute(&mut **tx)
            .await?;
            Ok(())
        })
    })
    .await;

    let err = result.expect_err("a user without any super admin must be rejected");
    assert!(matches!(err, AppError::Conflict { code: "last_super_admin", .. }), "got {err:?}");
    assert!(!err.to_string().contains("RAISE"), "SQL text leaked: {err}");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn unique_violations_map_to_conflict(pool: PgPool) {
    let insert = |email: &'static str| {
        let pool = pool.clone();
        async move {
            db::with_tx(&pool, |tx| {
                Box::pin(async move {
                    sqlx::query!(
                        "INSERT INTO app_user (email, first_name, last_name, password_hash, is_super_admin)
                         VALUES ($1, 'A', 'B', 'x', true)",
                        email,
                    )
                    .execute(&mut **tx)
                    .await?;
                    Ok(())
                })
            })
            .await
        }
    };
    insert("dup@example.com").await.unwrap();
    // citext: case-insensitive duplicate
    let err = insert("DUP@example.com").await.unwrap_err();
    assert!(matches!(err, AppError::Conflict { code: "email_taken", .. }), "got {err:?}");
}
