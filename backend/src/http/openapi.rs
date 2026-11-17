//! The OpenAPI document, served at `GET /api/openapi.json`. The frontend
//! client is generated from it.

use axum::{routing::get, Json, Router};
use utoipa::{
    openapi::security::{ApiKey, ApiKeyValue, SecurityScheme},
    Modify, OpenApi, ToSchema,
};

use crate::AppState;

/// Every error: `{"error": {"code": "snake_case", "message": "..."}}`. The
/// codes are listed in the README.
#[derive(ToSchema)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(ToSchema)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

struct SessionCookie;

impl Modify for SessionCookie {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme("session", SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::with_description(
            "sid",
            "Session cookie set by POST /api/auth/login. Non-GET requests also need an Origin header equal to the app origin.",
        ))));
    }
}

#[derive(OpenApi)]
#[openapi(
    info(title = "School ticketing API", description = "Branches, issues, work, events and notifications."),
    security(("session" = [])),
    modifiers(&SessionCookie),
    // Transition and Format are only used as parameters, so register them explicitly.
    components(schemas(ErrorResponse, crate::domain::work_items::Transition, crate::domain::permission_config::Format)),
    paths(
        super::health::healthz,
        super::auth::login_handler, super::auth::logout, super::auth::me, super::auth::update_me, super::auth::change_password,
        super::profile::set_cover, super::profile::remove_cover, super::profile::public, super::profile::cover,
        super::profile::set_avatar, super::profile::remove_avatar, super::profile::avatar, super::profile::avatars,
        super::directory::list,
        super::permissions::catalog,
        super::branches::list, super::branches::create, super::branches::show, super::branches::update,
        super::branches::appoint_admin, super::branches::demote_admin,
        super::branches::grant_super_admin, super::branches::revoke_super_admin, super::branches::root_users, super::branches::root_user_names,
        super::members::list, super::members::add, super::members::update, super::members::remove,
        super::members::effective_permissions, super::members::reset_password, super::members::set_active,
        super::members::recipients, super::members::recipient_departments, super::members::import, super::members::import_template,
        super::departments::list, super::departments::create, super::departments::update, super::departments::remove,
        super::departments::add_member, super::departments::remove_member,
        super::departments::make_head, super::departments::remove_head,
        super::permission_groups::list, super::permission_groups::create, super::permission_groups::update,
        super::permission_groups::remove, super::permission_groups::list_school, super::permission_groups::create_school,
        super::permission_groups::attach, super::permission_groups::detach,
        super::permission_groups::export, super::permission_groups::import,
        super::issues::list, super::issues::create, super::issues::show, super::issues::by_number,
        super::issues::update, super::issues::close, super::issues::cancel, super::issues::delete_issue,
        super::issues::add_target, super::issues::remove_target,
        super::issues::mark_read, super::issues::watch, super::issues::unwatch, super::issues::history,
        super::issues::mute, super::issues::unmute, super::issues::pass, super::issues::tags,
        super::work_items::list, super::work_items::show, super::work_items::transition,
        super::comments::list, super::comments::create, super::comments::update, super::comments::remove,
        super::reports::list, super::reports::create, super::reports::update, super::reports::submit,
        super::attachments::upload, super::attachments::download,
        super::events::calendar, super::events::respond, super::events::rsvps,
        super::notifications::list, super::notifications::unread_count,
        super::notifications::read, super::notifications::read_all, super::notifications::stream,
        super::dashboard::show, super::dashboard::export, super::dashboard::export_people,
        super::settings::show, super::settings::update,
        super::templates::list, super::templates::create, super::templates::update,
    )
)]
pub struct ApiDoc;

pub fn routes() -> Router<AppState> {
    Router::new().route("/openapi.json", get(|| async { Json(ApiDoc::openapi()) }))
}
