//! Shared test harness. Each `#[sqlx::test]` gets a fresh database with all
//! migrations applied; `TestApp` wraps the router so tests call it in-process.

#![allow(dead_code)]

use axum::{
    body::Body,
    http::{header, HeaderMap, Method, Request, StatusCode},
    Router,
};
use backend::{
    auth::password::{self, Password},
    config::LogFormat,
    http, AppState, Config,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

pub const APP_ORIGIN: &str = "http://localhost:5173";
pub const ROOT_EMAIL: &str = "root@example.com";
pub const ROOT_PASSWORD: &str = "root-password-1";

pub fn test_config() -> Config {
    Config {
        database_url: String::new(), // the pool is supplied by sqlx::test
        database_max_connections: 5,
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        app_origin: APP_ORIGIN.to_owned(),
        cookie_secure: false,
        log_format: LogFormat::Pretty,
        storage_dir: String::new(), // set per TestApp
        jobs_enabled: false,
    }
}

pub struct TestApp {
    pub router: Router,
    pub db: PgPool,
    pub state: AppState,
    /// Attachment storage, deleted when the test ends.
    pub storage: tempfile::TempDir,
}

impl TestApp {
    pub fn new(db: PgPool) -> Self {
        let storage = tempfile::tempdir().unwrap();
        let mut config = test_config();
        config.storage_dir = storage.path().to_string_lossy().into_owned();
        let state = AppState::new(db.clone(), config);
        let router = http::router(state.clone());
        Self { router, db, state, storage }
    }

    pub fn req(&self, method: Method, uri: &str) -> TestRequest<'_> {
        TestRequest {
            app: self,
            method,
            uri: uri.to_owned(),
            body: None,
            raw: None,
            cookie: None,
            origin: Some(APP_ORIGIN.to_owned()),
        }
    }

    pub async fn get(&self, uri: &str) -> TestResponse {
        self.req(Method::GET, uri).send().await
    }

    pub async fn post(&self, uri: &str, body: Value) -> TestResponse {
        self.req(Method::POST, uri).json(body).send().await
    }

    pub async fn login(&self, email: &str, password: &str) -> TestResponse {
        self.post("/api/auth/login", json!({ "email": email, "password": password })).await
    }

    /// Logs in and returns the `sid=...` cookie pair; panics on failure.
    pub async fn session(&self, email: &str, password: &str) -> String {
        let res = self.login(email, password).await;
        assert_eq!(res.status, StatusCode::OK, "login as {email} failed: {}", res.body);
        res.session_cookie().expect("login sets the session cookie")
    }
}

pub struct TestRequest<'a> {
    app: &'a TestApp,
    method: Method,
    uri: String,
    body: Option<Value>,
    raw: Option<(String, Vec<u8>)>,
    cookie: Option<String>,
    origin: Option<String>,
}

impl TestRequest<'_> {
    /// A non-JSON body, e.g. multipart.
    pub fn raw(mut self, content_type: &str, body: Vec<u8>) -> Self {
        self.raw = Some((content_type.to_owned(), body));
        self
    }

    pub fn json(mut self, body: Value) -> Self {
        self.body = Some(body);
        self
    }

    pub fn cookie(mut self, cookie: &str) -> Self {
        self.cookie = Some(cookie.to_owned());
        self
    }

    /// `None` sends no `Origin` header.
    pub fn origin(mut self, origin: Option<&str>) -> Self {
        self.origin = origin.map(str::to_owned);
        self
    }

    pub async fn send(self) -> TestResponse {
        let mut req = Request::builder().method(self.method).uri(&self.uri);
        if let Some(origin) = &self.origin {
            req = req.header(header::ORIGIN, origin);
        }
        if let Some(cookie) = &self.cookie {
            req = req.header(header::COOKIE, cookie);
        }
        let body = match (self.body, self.raw) {
            (Some(json), _) => {
                req = req.header(header::CONTENT_TYPE, "application/json");
                Body::from(json.to_string())
            }
            (None, Some((content_type, bytes))) => {
                req = req.header(header::CONTENT_TYPE, content_type);
                Body::from(bytes)
            }
            (None, None) => Body::empty(),
        };
        let res = self.app.router.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let body = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
        TestResponse { status, headers, body, bytes: bytes.to_vec() }
    }
}

pub struct TestResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Value,
    /// The raw body, for downloads.
    pub bytes: Vec<u8>,
}

impl TestResponse {
    pub fn error_code(&self) -> Option<&str> {
        self.body["error"]["code"].as_str()
    }

    pub fn set_cookie(&self) -> Option<&str> {
        self.headers.get(header::SET_COOKIE).and_then(|v| v.to_str().ok())
    }

    /// The `sid=<token>` pair from `Set-Cookie`, ready to send back.
    pub fn session_cookie(&self) -> Option<String> {
        let pair = self.set_cookie()?.split(';').next()?.trim();
        (pair.starts_with("sid=") && pair.len() > 4).then(|| pair.to_owned())
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

pub struct NewUser<'a> {
    pub email: &'a str,
    pub password: &'a str,
    pub is_super_admin: bool,
    pub must_change_password: bool,
}

impl<'a> NewUser<'a> {
    pub fn member(email: &'a str, password: &'a str) -> Self {
        Self { email, password, is_super_admin: false, must_change_password: false }
    }
}

pub async fn create_user(db: &PgPool, user: NewUser<'_>) -> Uuid {
    let hash = password::hash(&Password::new(user.password)).unwrap();
    sqlx::query_scalar!(
        r#"
        INSERT INTO app_user (email, first_name, last_name, password_hash, is_super_admin, must_change_password)
        VALUES ($1::text, 'Test', 'User', $2, $3, $4)
        RETURNING id
        "#,
        user.email,
        hash,
        user.is_super_admin,
        user.must_change_password,
    )
    .fetch_one(db)
    .await
    .unwrap()
}

/// The schema requires an active super admin as soon as any user exists, so
/// tests create this one first.
pub async fn create_root(db: &PgPool) -> Uuid {
    create_user(
        db,
        NewUser { email: ROOT_EMAIL, password: ROOT_PASSWORD, is_super_admin: true, must_change_password: false },
    )
    .await
}

/// Creates a branch with `admin` as its first admin (one transaction, as the
/// deferred "branch has an admin" trigger requires).
pub async fn create_branch(db: &PgPool, code: &str, admin: Uuid) -> Uuid {
    let mut tx = db.begin().await.unwrap();
    let branch_id = sqlx::query_scalar!("INSERT INTO branch (code, name) VALUES ($1, $1) RETURNING id", code)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO branch_membership (user_id, branch_id, is_admin) VALUES ($1, $2, true)",
        admin,
        branch_id
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
    branch_id
}

pub async fn add_member(db: &PgPool, branch_id: Uuid, user_id: Uuid) {
    sqlx::query!("INSERT INTO branch_membership (user_id, branch_id) VALUES ($1, $2)", user_id, branch_id)
        .execute(db)
        .await
        .unwrap();
}

/// Creates a group in the branch with the given grants and members.
pub async fn create_group(
    db: &PgPool,
    branch_id: Uuid,
    name: &str,
    grants: &[(&str, Option<&str>, &str)],
    members: &[Uuid],
) -> Uuid {
    let group_id =
        sqlx::query_scalar!("INSERT INTO user_group (branch_id, name) VALUES ($1, $2) RETURNING id", branch_id, name)
            .fetch_one(db)
            .await
            .unwrap();
    for (key, issue_type, scope) in grants {
        sqlx::query!(
            r#"INSERT INTO group_permission (group_id, permission_key, issue_type_id, scope)
               VALUES ($1, $2, (SELECT id FROM issue_type WHERE code = $3), $4::text::permission_scope)"#,
            group_id,
            key,
            *issue_type,
            scope
        )
        .execute(db)
        .await
        .unwrap();
    }
    for user in members {
        sqlx::query!(
            "INSERT INTO group_member (group_id, user_id, branch_id) VALUES ($1, $2, $3)",
            group_id,
            user,
            branch_id
        )
        .execute(db)
        .await
        .unwrap();
    }
    group_id
}

/// Every grantable permission at branch scope: an "admin-like" group.
pub const EVERYTHING: &[(&str, Option<&str>, &str)] = &[
    ("issue.read", None, "branch"),
    ("issue.read_private", None, "branch"),
    ("issue.create", None, "branch"),
    ("issue.edit", None, "branch"),
    ("issue.close", None, "branch"),
    ("issue.set_private", None, "branch"),
    ("issue.target", None, "branch"),
    ("work_item.update", None, "branch"),
    ("work_item.assign", None, "branch"),
    ("work_item.approve", None, "branch"),
    ("comment.create", None, "branch"),
    ("comment.internal", None, "branch"),
    ("comment.moderate", None, "branch"),
    ("member.view", None, "branch"),
    ("member.manage", None, "branch"),
    ("dashboard.branch", None, "branch"),
    ("export.run", None, "branch"),
];

pub const PW: &str = "correct-horse-1";

/// A small organisation used by the phase 2 tests.
///
/// - `root`: super admin
/// - branch A: `admin_a` (admin), `manager_a` (group with member.manage),
///   `boss_like_a` (group with every grantable permission), `plain_a`
/// - branch B: `admin_b`
/// - `multi`: a plain member of both A and B
pub struct Org {
    pub root: Uuid,
    pub branch_a: Uuid,
    pub branch_b: Uuid,
    pub admin_a: Uuid,
    pub admin_b: Uuid,
    pub manager_a: Uuid,
    pub boss_like_a: Uuid,
    pub plain_a: Uuid,
    pub multi: Uuid,
    pub managers_group: Uuid,
    pub boss_like_group: Uuid,
}

impl Org {
    pub async fn seed(db: &PgPool) -> Self {
        let root = create_root(db).await;
        let user = |email: &'static str| create_user(db, NewUser::member(email, PW));
        let admin_a = user("admin_a@example.com").await;
        let admin_b = user("admin_b@example.com").await;
        let manager_a = user("manager_a@example.com").await;
        let boss_like_a = user("boss_like_a@example.com").await;
        let plain_a = user("plain_a@example.com").await;
        let multi = user("multi@example.com").await;

        let branch_a = create_branch(db, "AAA", admin_a).await;
        let branch_b = create_branch(db, "BBB", admin_b).await;
        for u in [manager_a, boss_like_a, plain_a, multi] {
            add_member(db, branch_a, u).await;
        }
        add_member(db, branch_b, multi).await;

        let managers_group =
            create_group(db, branch_a, "Managers", &[("member.manage", None, "branch")], &[manager_a]).await;
        let boss_like_group = create_group(db, branch_a, "Deputies", EVERYTHING, &[boss_like_a]).await;
        Self {
            root,
            branch_a,
            branch_b,
            admin_a,
            admin_b,
            manager_a,
            boss_like_a,
            plain_a,
            multi,
            managers_group,
            boss_like_group,
        }
    }
}

// ---------------------------------------------------------------------------
// Request and assertion helpers
// ---------------------------------------------------------------------------

pub async fn as_user(app: &TestApp, email: &str) -> String {
    app.session(email, PW).await
}

pub async fn as_root(app: &TestApp) -> String {
    app.session(ROOT_EMAIL, ROOT_PASSWORD).await
}

pub async fn call(app: &TestApp, cookie: &str, method: Method, uri: &str, body: Option<Value>) -> TestResponse {
    let mut req = app.req(method, uri).cookie(cookie);
    if let Some(b) = body {
        req = req.json(b);
    }
    req.send().await
}

pub fn assert_status(res: &TestResponse, status: StatusCode, code: Option<&str>) {
    assert_eq!(res.status, status, "body: {}", res.body);
    if let Some(code) = code {
        assert_eq!(res.error_code(), Some(code), "body: {}", res.body);
    }
}

pub async fn audit_count(db: &PgPool, entity_type: &str, action: &str) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM audit_log WHERE entity_type = $1 AND action = $2"#,
        entity_type,
        action
    )
    .fetch_one(db)
    .await
    .unwrap()
}

pub async fn notifications_of(db: &PgPool, user: Uuid, kind: &str) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM notification WHERE recipient_id = $1 AND kind = $2"#,
        user,
        kind
    )
    .fetch_one(db)
    .await
    .unwrap()
}

/// Uploads one file as `multipart/form-data`, with optional extra text fields.
pub async fn upload(
    app: &TestApp,
    cookie: &str,
    issue_id: &str,
    file: (&str, &str, &[u8]),
    fields: &[(&str, String)],
) -> TestResponse {
    let boundary = "----test-boundary-7d1a";
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    let (file_name, content_type, data) = file;
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {content_type}\r\n\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    app.req(Method::POST, &format!("/api/issues/{issue_id}/attachments"))
        .cookie(cookie)
        .raw(&format!("multipart/form-data; boundary={boundary}"), body)
        .send()
        .await
}
