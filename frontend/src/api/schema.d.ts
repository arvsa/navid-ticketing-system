export interface paths {
    "/api/attachments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/attachments/{id}: streams the file after the authorization check. */
        get: operations["get__api_attachments_id_"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/auth/login */
        post: operations["post__api_auth_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/auth/logout */
        post: operations["post__api_auth_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/avatars": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/avatars: everyone with a profile picture and its version. */
        get: operations["get__api_avatars"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_branches"];
        put?: never;
        post: operations["post__api_branches"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_branches_id_"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["patch__api_branches_id_"];
        trace?: never;
    };
    "/api/branches/{id}/admins/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["put__api_branches_id_admins_user_id_"];
        post?: never;
        delete: operations["delete__api_branches_id_admins_user_id_"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches/{id}/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_branches_id_groups"];
        put?: never;
        post: operations["post__api_branches_id_groups"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_branches_id_members"];
        put?: never;
        post: operations["post__api_branches_id_members"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches/{id}/members/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /api/branches/{id}/members/import, `multipart/form-data` with a `file`
         *     part (xlsx, xls, ods or csv) and optional `dry_run` and `skip_errors`
         *     fields (`true`): check only, or import the good rows and leave out the
         *     ones with a problem.
         */
        post: operations["post__api_branches_id_members_import"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches/{id}/members/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["delete__api_branches_id_members_user_id_"];
        options?: never;
        head?: never;
        patch: operations["patch__api_branches_id_members_user_id_"];
        trace?: never;
    };
    "/api/branches/{id}/members/{user_id}/effective-permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_branches_id_members_user_id_effective_permissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/calendar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_calendar"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/comments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["delete__api_comments_id_"];
        options?: never;
        head?: never;
        patch: operations["patch__api_comments_id_"];
        trace?: never;
    };
    "/api/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_dashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/directory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /api/directory: every active branch with its departments and people,
         *     for everyone signed in.
         */
        get: operations["get__api_directory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/events/{id}/rsvp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["put__api_events_id_rsvp"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/events/{id}/rsvps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_events_id_rsvps"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/exports?branch_ids=&types=ticket,report,event,action&from=&to=&state=&priority=&tags=&q=&dates=created */
        get: operations["get__api_exports"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/exports/people": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/exports/people?branch_ids= (super admins) */
        get: operations["get__api_exports_people"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/group-permissions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["delete__api_group_permissions_id_"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/groups/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["delete__api_groups_id_"];
        options?: never;
        head?: never;
        patch: operations["patch__api_groups_id_"];
        trace?: never;
    };
    "/api/groups/{id}/heads/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Make a department member one of its heads (branch admins). */
        put: operations["put__api_groups_id_heads_user_id_"];
        post?: never;
        /** Stop someone being a head of a department (they stay a member). */
        delete: operations["delete__api_groups_id_heads_user_id_"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/groups/{id}/members/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["put__api_groups_id_members_user_id_"];
        post?: never;
        delete: operations["delete__api_groups_id_members_user_id_"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/groups/{id}/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_groups_id_permissions"];
        /**
         * Save several grant changes at once (one notification, all or nothing).
         *     Returns the group's grants afterwards.
         */
        put: operations["put__api_groups_id_permissions"];
        post: operations["post__api_groups_id_permissions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/healthz: no auth. Fails with 500 if the database is unreachable. */
        get: operations["get__api_healthz"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_issues"];
        put?: never;
        post: operations["post__api_issues"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/by-number/{n}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_issues_by_number_n_"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The tags in use on issues the viewer can see, for filtering. */
        get: operations["get__api_issues_tags"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_issues_id_"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["patch__api_issues_id_"];
        trace?: never;
    };
    "/api/issues/{id}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /api/issues/{id}/attachments, `multipart/form-data` with a `file`
         *     part and optional `comment_id` or `report_id` fields.
         */
        post: operations["post__api_issues_id_attachments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__api_issues_id_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__api_issues_id_close"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_issues_id_comments"];
        put?: never;
        post: operations["post__api_issues_id_comments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_issues_id_history"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/mute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /api/issues/{id}/mute: no more updates (comments, changes) on this
         *     item; what needs you still reaches you.
         */
        put: operations["put__api_issues_id_mute"];
        post?: never;
        delete: operations["delete__api_issues_id_mute"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/pass": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/issues/{id}/pass: pass a question you were asked to someone else in your branch. */
        post: operations["post__api_issues_id_pass"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__api_issues_id_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_issues_id_reports"];
        put?: never;
        post: operations["post__api_issues_id_reports"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/targets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__api_issues_id_targets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/targets/{target_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["delete__api_issues_id_targets_target_id_"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/issues/{id}/watch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["put__api_issues_id_watch"];
        post?: never;
        delete: operations["delete__api_issues_id_watch"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/me: available while a password change is pending. */
        get: operations["get__api_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** PATCH /api/me: your bio, and your name if you're a super admin. */
        patch: operations["patch__api_me"];
        trace?: never;
    };
    "/api/me/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** PUT /api/me/avatar, `multipart/form-data` with a `file` part. */
        put: operations["put__api_me_avatar"];
        post?: never;
        /** DELETE /api/me/avatar */
        delete: operations["delete__api_me_avatar"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** PUT /api/me/cover, `multipart/form-data` with a `file` part. */
        put: operations["put__api_me_cover"];
        post?: never;
        /** DELETE /api/me/cover */
        delete: operations["delete__api_me_cover"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/me/password */
        post: operations["post__api_me_password"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/members/import-template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/members/import-template: an empty workbook with the header row. */
        get: operations["get__api_members_import_template"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_notifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__api_notifications_read_all"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications/unread-count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_notifications_unread_count"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__api_notifications_id_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /api/permissions: the grantable permission catalog, for the admin UI.
         *     Any signed-in user may read it; it describes rules, not data.
         */
        get: operations["get__api_permissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/recipient-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Groups in every branch, to send a school-wide item to. */
        get: operations["get__api_recipient_groups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/recipients": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** People in every branch, to send a school-wide item to. */
        get: operations["get__api_recipients"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["patch__api_reports_id_"];
        trace?: never;
    };
    "/api/reports/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__api_reports_id_submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/school-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** School-wide groups: their grants apply in every branch a member belongs to. */
        get: operations["get__api_school_groups"];
        put?: never;
        post: operations["post__api_school_groups"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/school-groups/{id}/copies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A school-wide group's copies, one per branch, with their member counts. */
        get: operations["get__api_school_groups_id_copies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/settings: no sign-in needed (the sign-in page shows the school's name). */
        get: operations["get__api_settings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** PATCH /api/settings: super admins only. */
        patch: operations["patch__api_settings"];
        trace?: never;
    };
    "/api/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Server-Sent Events: IDs-only change signals for this user. See the README. */
        get: operations["get__api_stream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/templates: everyone signed in; archived ones for super admins. */
        get: operations["get__api_templates"];
        put?: never;
        /** POST /api/templates: super admins only. */
        post: operations["post__api_templates"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** PATCH /api/templates/{id}: super admins only; also archives and restores. */
        patch: operations["patch__api_templates_id_"];
        trace?: never;
    };
    "/api/users/{id}/active": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["patch__api_users_id_active"];
        trace?: never;
    };
    "/api/users/{id}/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/users/{id}/avatar: the profile picture, cached for good like the cover. */
        get: operations["get__api_users_id_avatar"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /api/users/{id}/cover: the image. Its URL changes with every upload
         *     (`?v=<cover_version>`), so it's cached for good.
         */
        get: operations["get__api_users_id_cover"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/users/{id}/profile: bio, cover and picture, for everyone signed in. */
        get: operations["get__api_users_id_profile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__api_users_id_reset_password"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/super-admin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["put__api_users_id_super_admin"];
        post?: never;
        delete: operations["delete__api_users_id_super_admin"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/work-items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_work_items"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/work-items/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get__api_work_items_id_"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/work-items/{id}/{transition}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__api_work_items_id_transition_"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ActiveBody: {
            is_active: boolean;
        };
        AddedMember: {
            /** @description A new account was created. */
            created: boolean;
            /** @description A departed membership was restored. */
            reactivated: boolean;
            /** @description Only for new accounts, shown once. */
            temporary_password?: string | null;
            /** Format: uuid */
            user_id: string;
        };
        AttachmentMeta: {
            checksum_sha256: string;
            /** Format: uuid */
            comment_id?: string | null;
            content_type: string;
            /** Format: date-time */
            created_at: string;
            file_name: string;
            /** Format: int64 */
            file_size_bytes: number;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            issue_id: string;
            /** Format: uuid */
            report_id?: string | null;
            /** Format: uuid */
            uploaded_by: string;
        };
        /** @description Someone's profile picture, for the people list. */
        AvatarRef: {
            /** Format: uuid */
            user_id: string;
            version: string;
        };
        Branch: {
            code: string;
            /** Format: date-time */
            created_at: string;
            email?: string | null;
            /** Format: uuid */
            id: string;
            is_active: boolean;
            name: string;
            timezone: string;
            /** Format: date-time */
            updated_at: string;
        };
        BranchNumbers: {
            /** Format: uuid */
            branch_id: string;
            code: string;
            /**
             * Format: int64
             * @description Open work due from now to the end of the 7th day after today, in
             *     the branch's timezone.
             */
            due_next_7_days?: number | null;
            name: string;
            open_issues_by_type?: components["schemas"]["TypeCounts"] | null;
            /**
             * Format: int64
             * @description Open tickets the actor can see. Always present.
             */
            open_tickets: number;
            /** Format: int64 */
            overdue_work_items?: number | null;
            scope: components["schemas"]["NumbersScope"];
            work_items_by_status?: components["schemas"]["StatusCounts"] | null;
        };
        BranchPatch: {
            code?: string | null;
            /** @description `Some(None)` clears it. */
            email?: string | null;
            is_active?: boolean | null;
            name?: string | null;
            timezone?: string | null;
        };
        BranchRef: {
            code: string;
            /** Format: uuid */
            id: string;
            name: string;
        };
        CalendarEntry: {
            all_day: boolean;
            /** Format: uuid */
            branch_id?: string | null;
            /** Format: date-time */
            ends_at: string;
            /** Format: uuid */
            issue_id: string;
            key: string;
            location?: string | null;
            my_rsvp?: components["schemas"]["RsvpResponse"] | null;
            /** Format: int64 */
            number: number;
            /** Format: uuid */
            organizer_id: string;
            /** Format: date-time */
            starts_at: string;
            state: components["schemas"]["IssueState"];
            title: string;
        };
        CatalogEntry: {
            allowed_scopes: string[];
            description: string;
            key: string;
            per_issue_type: boolean;
        };
        ChangePasswordRequest: {
            current_password: components["schemas"]["Password"];
            new_password: components["schemas"]["Password"];
        };
        Comment: {
            attachments: components["schemas"]["AttachmentMeta"][];
            /** Format: uuid */
            author_id: string;
            /** @description `null` once deleted; the entry stays so threads keep their shape. */
            body?: string | null;
            /** Format: date-time */
            created_at: string;
            deleted: boolean;
            edited: boolean;
            /** Format: uuid */
            id: string;
            is_internal_only: boolean;
            /** Format: uuid */
            issue_id: string;
            mentions: string[];
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            work_item_id?: string | null;
        };
        CommentPatch: {
            body: string;
        };
        /** @enum {string} */
        CompletionMode: "shared" | "per_member";
        Dashboard: {
            branches: components["schemas"]["BranchNumbers"][];
            /** Format: date-time */
            generated_at: string;
            mine: components["schemas"]["MyNumbers"];
        };
        DeleteOutcome: {
            archived: boolean;
            /**
             * @description `true`: the group was hard-deleted. `false`: it is referenced by issue
             *     targets, so it was archived instead.
             */
            deleted: boolean;
        };
        DirectoryBranch: {
            code: string;
            /** @description The branch's contact address. */
            email?: string | null;
            groups: components["schemas"]["DirectoryGroup"][];
            /** Format: uuid */
            id: string;
            name: string;
            people: components["schemas"]["DirectoryPerson"][];
            timezone: string;
        };
        DirectoryGroup: {
            description?: string | null;
            /** @description Who runs the department (some of `member_ids`). */
            head_ids: string[];
            /** Format: uuid */
            id: string;
            /** @description Current, active members. */
            member_ids: string[];
            name: string;
        };
        DirectoryPerson: {
            email: string;
            first_name: string;
            /** @description Runs this branch. */
            is_admin: boolean;
            last_name: string;
            /** Format: uuid */
            user_id: string;
        };
        EffectivePermissions: {
            /** Format: uuid */
            branch_id: string;
            grants: components["schemas"]["SourcedGrant"][];
            /** @description Admins can do everything except super admin actions, whatever their groups grant. */
            is_admin: boolean;
            /** Format: uuid */
            user_id: string;
        };
        ErrorDetail: {
            code: string;
            message: string;
        };
        /**
         * @description Every error: `{"error": {"code": "snake_case", "message": "..."}}`. The
         *     codes are listed in the README.
         */
        ErrorResponse: {
            error: components["schemas"]["ErrorDetail"];
        };
        EventDetails: {
            all_day?: boolean;
            /** Format: date-time */
            ends_at: string;
            location?: string | null;
            /** Format: date-time */
            starts_at: string;
        };
        EventInput: components["schemas"]["EventDetails"] & {
            /** @description Minutes before the start; defaults to a day and an hour before. */
            reminders?: number[] | null;
        };
        EventPatch: {
            all_day?: boolean | null;
            /** Format: date-time */
            ends_at?: string | null;
            location?: string | null;
            /** @description Replaces the reminder list. */
            reminders?: number[] | null;
            /** Format: date-time */
            starts_at?: string | null;
        };
        /** @description What the event looks like to one viewer. */
        EventView: components["schemas"]["EventDetails"] & {
            my_rsvp?: components["schemas"]["RsvpResponse"] | null;
            /** @description Minutes before the start, largest first. */
            reminders: number[];
            rsvp_counts: components["schemas"]["RsvpCounts"];
        };
        Grant: {
            issue_type?: components["schemas"]["IssueType"] | null;
            permission: components["schemas"]["Permission"];
            scope: components["schemas"]["Scope"];
        };
        /**
         * @description Several grant changes saved together: all or nothing, one audit row per
         *     grant, and a single notification and event (instead of one per change).
         */
        GrantChanges: {
            grant?: components["schemas"]["NewGrant"][];
            /** @description Grant ids of this group to remove. */
            revoke?: string[];
        };
        Group: {
            /** Format: date-time */
            archived_at?: string | null;
            /**
             * Format: uuid
             * @description `null`: a school-wide group (super admins only). It has no members of
             *     its own: every branch has a copy of it, with the same grants.
             */
            branch_id?: string | null;
            /** Format: date-time */
            created_at: string;
            description?: string | null;
            /** @description A department's heads (members of this group). */
            head_ids: string[];
            /** Format: uuid */
            id: string;
            is_default: boolean;
            /**
             * @description `department` (IT, Health: handles work for others, has heads) or
             *     `team` (a role or committee: Principals, Teachers).
             */
            kind: string;
            /**
             * Format: int64
             * @description For a school-wide group: the members of all its branch copies.
             */
            member_count: number;
            name: string;
            /**
             * Format: uuid
             * @description On a branch group: the school-wide group it's a copy of. Its name,
             *     grants and archiving follow that group; branch admins choose members.
             */
            template_id?: string | null;
        };
        GroupGrant: {
            /** Format: date-time */
            created_at: string;
            /** Format: uuid */
            group_id: string;
            /** Format: uuid */
            id: string;
            issue_type?: string | null;
            permission: string;
            scope: components["schemas"]["Scope"];
        };
        GroupPatch: {
            /** @description `true` archives, `false` restores. */
            archived?: boolean | null;
            description?: string | null;
            /** @description `team` or `department`. Turning a department into a team removes its heads. */
            kind?: string | null;
            name?: string | null;
        };
        GroupRef: {
            /** @description The school-wide "Everyone" group, which every user is in. */
            everyone: boolean;
            /** Format: uuid */
            id: string;
            name: string;
        };
        /**
         * @description One audit row about the issue.
         *
         *     | `entity_type`   | `action`                                                        |
         *     |-----------------|-----------------------------------------------------------------|
         *     | `issue`         | `create`, `update`, `close`, `cancel`, `auto_close`             |
         *     | `issue_target`  | `add`, `remove`                                                 |
         *     | `work_item`     | `create`, `start`, `block`, `unblock`, `submit`, `approve`, `reject`, `claim`, `assign`, `cancel`, `unassign` |
         *     | `issue_comment` | `delete`                                                        |
         *
         *     `old_value` / `new_value` hold only the changed fields; times in them are
         *     RFC 3339.
         */
        HistoryEntry: {
            action: string;
            /**
             * Format: uuid
             * @description `null` = the system (jobs, auto-close).
             */
            actor_id?: string | null;
            /**
             * Format: uuid
             * @description `work_item` entries: the item's current assignee (`null` = unassigned).
             */
            assignee_id?: string | null;
            /**
             * Format: int64
             * @description Rows written by one request share a `batch_id` (the `id` of the first
             *     of them), e.g. an issue with its targets and work items, or an approval
             *     and the auto-close it caused.
             */
            batch_id: number;
            /**
             * Format: uuid
             * @description The branch the row is about: the work item's or target's branch, or the
             *     issue's (`null` for a school-wide issue).
             */
            branch_id?: string | null;
            /** Format: date-time */
            created_at: string;
            entity_id: string;
            entity_type: string;
            /** Format: int64 */
            id: number;
            new_value?: unknown;
            old_value?: unknown;
        };
        /** @enum {string} */
        ImportOutcome: "create" | "add" | "reactivate" | "skip" | "error";
        ImportReport: {
            /**
             * @description False for a dry run, or when any row has an error and they weren't
             *     skipped (nothing was written).
             */
            imported: boolean;
            rows: components["schemas"]["ImportRow"][];
        };
        ImportRow: {
            email: string;
            error?: components["schemas"]["RowError"] | null;
            first_name: string;
            last_name: string;
            outcome: components["schemas"]["ImportOutcome"];
            /**
             * Format: int32
             * @description The row number in the file, counting the header.
             */
            row: number;
            /** @description Only for new accounts once imported, shown once. */
            temporary_password?: string | null;
            /**
             * Format: uuid
             * @description Set once imported.
             */
            user_id?: string | null;
        };
        IssueDetail: {
            /** @description Files on the issue itself; comment and report files come with those. */
            attachments: components["schemas"]["AttachmentMeta"][];
            /** Format: uuid */
            branch_id?: string | null;
            /** Format: date-time */
            closed_at?: string | null;
            /** Format: uuid */
            closed_by?: string | null;
            completion_mode: components["schemas"]["CompletionMode"];
            /** Format: date-time */
            created_at: string;
            /** Format: uuid */
            created_by: string;
            /** @description The creator's full name, so it shows where their branch isn't visible. */
            created_by_name: string;
            description?: string | null;
            event?: components["schemas"]["EventView"] | null;
            /** Format: uuid */
            id: string;
            key: string;
            /** Format: date-time */
            last_read_at?: string | null;
            /** @description The viewer muted its updates (comments, changes). What needs them still reaches them. */
            muted: boolean;
            /** Format: int64 */
            number: number;
            priority: components["schemas"]["Priority"];
            /** @description Each piece of work needs a submitted written report (fixed at creation). */
            requires_report: boolean;
            state: components["schemas"]["IssueState"];
            tags: string[];
            targets: components["schemas"]["Target"][];
            /**
             * Format: uuid
             * @description The template it was made from, if any.
             */
            template_id?: string | null;
            title: string;
            type: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: int32 */
            version: number;
            watching: boolean;
            work_items: components["schemas"]["WorkItem"][];
        };
        IssuePatch: {
            description?: string | null;
            event?: components["schemas"]["EventPatch"] | null;
            priority?: components["schemas"]["Priority"] | null;
            /** @description Replaces the tags. */
            tags?: string[] | null;
            title?: string | null;
            /**
             * Format: int32
             * @description The version the client last saw.
             */
            version: number;
        };
        /** @enum {string} */
        IssueState: "open" | "closed" | "cancelled";
        IssueSummary: {
            /** Format: uuid */
            branch_id?: string | null;
            /** Format: date-time */
            created_at: string;
            /** Format: uuid */
            created_by: string;
            /** @description The creator's full name, so it shows where their branch isn't visible. */
            created_by_name: string;
            /** Format: int64 */
            done_count: number;
            /** Format: uuid */
            id: string;
            is_overdue: boolean;
            /** @description Display form, `ISS-<number>`. */
            key: string;
            /** Format: date-time */
            last_activity_at: string;
            /** Format: int64 */
            number: number;
            priority: components["schemas"]["Priority"];
            state: components["schemas"]["IssueState"];
            tags: string[];
            /** Format: uuid */
            template_id?: string | null;
            title: string;
            type: string;
            /** @description Activity since the actor last opened the issue. */
            unread: boolean;
            /** Format: int64 */
            work_item_count: number;
        };
        /**
         * @description The three issue types (`issue_type.code`). Reports are actions made
         *     from the Report template.
         * @enum {string}
         */
        IssueType: "ticket" | "event" | "action";
        LoginRequest: {
            email: string;
            password: components["schemas"]["Password"];
        };
        MeResponse: {
            memberships: components["schemas"]["MembershipView"][];
            user: components["schemas"]["UserProfile"];
        };
        Member: {
            email: string;
            first_name: string;
            is_active: boolean;
            is_admin: boolean;
            /** Format: date-time */
            joined_at: string;
            last_name: string;
            /** Format: date-time */
            left_at?: string | null;
            /** Format: uuid */
            user_id: string;
        };
        MembershipView: {
            branch: components["schemas"]["BranchRef"];
            /**
             * @description Effective grants in this branch (union over the user's groups).
             *     Branch admins can do everything except super admin actions regardless.
             */
            grants: components["schemas"]["Grant"][];
            /**
             * @description Departments in this branch the user heads: they run their members and
             *     the work and questions sent to them.
             */
            heads: string[];
            is_admin: boolean;
            /** Format: date-time */
            joined_at: string;
        };
        MyNumbers: {
            /** Format: int64 */
            awaiting_my_approval: number;
            /** Format: int64 */
            open_work_items: number;
            /** Format: int64 */
            unread_notifications: number;
            upcoming_events: components["schemas"]["UpcomingEvent"][];
        };
        /** @description Absent fields stay as they are; `"bio": null` (or blank) clears the bio. */
        MyProfilePatch: {
            bio?: string | null;
            /** @description Super admins only. */
            first_name?: string | null;
            /** @description Super admins only. */
            last_name?: string | null;
        };
        NewBranch: {
            code: string;
            email?: string | null;
            /**
             * Format: uuid
             * @description Optional: a new branch can get its admin later, once its people are in.
             */
            first_admin_user_id?: string | null;
            name: string;
            timezone: string;
        };
        NewComment: {
            body: string;
            /** @description Deprecated: staff-only comments will be removed in the future. */
            is_internal_only?: boolean;
            /** @description Parsed client-side from `@` mentions; non-readers are dropped silently. */
            mention_user_ids?: string[];
            /** Format: uuid */
            work_item_id?: string | null;
        };
        NewGrant: {
            issue_type?: string | null;
            permission: string;
            scope: string;
        };
        NewGroup: {
            description?: string | null;
            /** @description `team` (default) or `department`. */
            kind?: string | null;
            name: string;
        };
        NewIssue: {
            /**
             * Format: uuid
             * @description `null` = cross-branch: whole branches (super admins) or people in any
             *     branch (super admins and holders of `issue.target_other_branches`).
             */
            branch_id?: string | null;
            completion_mode?: components["schemas"]["CompletionMode"];
            description?: string | null;
            event?: components["schemas"]["EventInput"] | null;
            priority?: components["schemas"]["Priority"];
            /**
             * Format: date-time
             * @description Actions only; defaults to now + the template's or the type's default SLA.
             */
            sla_due_at?: string | null;
            /** @description Free tags, on top of the template's. */
            tags?: string[];
            targets?: components["schemas"]["TargetInput"][];
            /**
             * Format: uuid
             * @description Make it from this template: it must be of the same type. Its tag is
             *     added and its rules (a written report per piece of work) apply.
             */
            template_id?: string | null;
            title: string;
            type: string;
        };
        NewMember: {
            email: string;
            /** @description Required when the account doesn't exist yet. */
            first_name?: string | null;
            last_name?: string | null;
        };
        NewReport: {
            body: string;
            title: string;
            /**
             * Format: uuid
             * @description The work item this report is for; omit for a self-filed report.
             */
            work_item_id?: string | null;
        };
        NewTarget: components["schemas"]["TargetInput"] & {
            /**
             * Format: date-time
             * @description For new work items; defaults to the issue's existing SLA, else the type default.
             */
            sla_due_at?: string | null;
        };
        NewTemplate: {
            /** Format: int32 */
            default_sla_hours?: number | null;
            description?: string | null;
            name: string;
            requires_report?: boolean;
            tag?: string | null;
            /** @description `ticket`, `action` or `event`; can't change later. */
            type: string;
        };
        Notification: {
            /**
             * Format: uuid
             * @description `null` = the system.
             */
            actor_id?: string | null;
            /** Format: uuid */
            branch_id?: string | null;
            /** Format: date-time */
            created_at: string;
            /** Format: int64 */
            id: number;
            /** Format: uuid */
            issue_id?: string | null;
            /** @description `ISS-<number>` and title, for display. */
            issue_key?: string | null;
            issue_title?: string | null;
            kind: string;
            payload: unknown;
            /** Format: date-time */
            read_at?: string | null;
            /** Format: uuid */
            work_item_id?: string | null;
        };
        /** @enum {string} */
        NumbersScope: "branch" | "personal";
        Page_Branch: {
            items: {
                code: string;
                /** Format: date-time */
                created_at: string;
                email?: string | null;
                /** Format: uuid */
                id: string;
                is_active: boolean;
                name: string;
                timezone: string;
                /** Format: date-time */
                updated_at: string;
            }[];
            next_cursor?: string | null;
        };
        Page_CalendarEntry: {
            items: {
                all_day: boolean;
                /** Format: uuid */
                branch_id?: string | null;
                /** Format: date-time */
                ends_at: string;
                /** Format: uuid */
                issue_id: string;
                key: string;
                location?: string | null;
                my_rsvp?: components["schemas"]["RsvpResponse"] | null;
                /** Format: int64 */
                number: number;
                /** Format: uuid */
                organizer_id: string;
                /** Format: date-time */
                starts_at: string;
                state: components["schemas"]["IssueState"];
                title: string;
            }[];
            next_cursor?: string | null;
        };
        Page_Comment: {
            items: {
                attachments: components["schemas"]["AttachmentMeta"][];
                /** Format: uuid */
                author_id: string;
                /** @description `null` once deleted; the entry stays so threads keep their shape. */
                body?: string | null;
                /** Format: date-time */
                created_at: string;
                deleted: boolean;
                edited: boolean;
                /** Format: uuid */
                id: string;
                is_internal_only: boolean;
                /** Format: uuid */
                issue_id: string;
                mentions: string[];
                /** Format: date-time */
                updated_at: string;
                /** Format: uuid */
                work_item_id?: string | null;
            }[];
            next_cursor?: string | null;
        };
        Page_Group: {
            items: {
                /** Format: date-time */
                archived_at?: string | null;
                /**
                 * Format: uuid
                 * @description `null`: a school-wide group (super admins only). It has no members of
                 *     its own: every branch has a copy of it, with the same grants.
                 */
                branch_id?: string | null;
                /** Format: date-time */
                created_at: string;
                description?: string | null;
                /** @description A department's heads (members of this group). */
                head_ids: string[];
                /** Format: uuid */
                id: string;
                is_default: boolean;
                /**
                 * @description `department` (IT, Health: handles work for others, has heads) or
                 *     `team` (a role or committee: Principals, Teachers).
                 */
                kind: string;
                /**
                 * Format: int64
                 * @description For a school-wide group: the members of all its branch copies.
                 */
                member_count: number;
                name: string;
                /**
                 * Format: uuid
                 * @description On a branch group: the school-wide group it's a copy of. Its name,
                 *     grants and archiving follow that group; branch admins choose members.
                 */
                template_id?: string | null;
            }[];
            next_cursor?: string | null;
        };
        Page_GroupGrant: {
            items: {
                /** Format: date-time */
                created_at: string;
                /** Format: uuid */
                group_id: string;
                /** Format: uuid */
                id: string;
                issue_type?: string | null;
                permission: string;
                scope: components["schemas"]["Scope"];
            }[];
            next_cursor?: string | null;
        };
        Page_HistoryEntry: {
            items: {
                action: string;
                /**
                 * Format: uuid
                 * @description `null` = the system (jobs, auto-close).
                 */
                actor_id?: string | null;
                /**
                 * Format: uuid
                 * @description `work_item` entries: the item's current assignee (`null` = unassigned).
                 */
                assignee_id?: string | null;
                /**
                 * Format: int64
                 * @description Rows written by one request share a `batch_id` (the `id` of the first
                 *     of them), e.g. an issue with its targets and work items, or an approval
                 *     and the auto-close it caused.
                 */
                batch_id: number;
                /**
                 * Format: uuid
                 * @description The branch the row is about: the work item's or target's branch, or the
                 *     issue's (`null` for a school-wide issue).
                 */
                branch_id?: string | null;
                /** Format: date-time */
                created_at: string;
                entity_id: string;
                entity_type: string;
                /** Format: int64 */
                id: number;
                new_value?: unknown;
                old_value?: unknown;
            }[];
            next_cursor?: string | null;
        };
        Page_IssueSummary: {
            items: {
                /** Format: uuid */
                branch_id?: string | null;
                /** Format: date-time */
                created_at: string;
                /** Format: uuid */
                created_by: string;
                /** @description The creator's full name, so it shows where their branch isn't visible. */
                created_by_name: string;
                /** Format: int64 */
                done_count: number;
                /** Format: uuid */
                id: string;
                is_overdue: boolean;
                /** @description Display form, `ISS-<number>`. */
                key: string;
                /** Format: date-time */
                last_activity_at: string;
                /** Format: int64 */
                number: number;
                priority: components["schemas"]["Priority"];
                state: components["schemas"]["IssueState"];
                tags: string[];
                /** Format: uuid */
                template_id?: string | null;
                title: string;
                type: string;
                /** @description Activity since the actor last opened the issue. */
                unread: boolean;
                /** Format: int64 */
                work_item_count: number;
            }[];
            next_cursor?: string | null;
        };
        Page_Member: {
            items: {
                email: string;
                first_name: string;
                is_active: boolean;
                is_admin: boolean;
                /** Format: date-time */
                joined_at: string;
                last_name: string;
                /** Format: date-time */
                left_at?: string | null;
                /** Format: uuid */
                user_id: string;
            }[];
            next_cursor?: string | null;
        };
        Page_Notification: {
            items: {
                /**
                 * Format: uuid
                 * @description `null` = the system.
                 */
                actor_id?: string | null;
                /** Format: uuid */
                branch_id?: string | null;
                /** Format: date-time */
                created_at: string;
                /** Format: int64 */
                id: number;
                /** Format: uuid */
                issue_id?: string | null;
                /** @description `ISS-<number>` and title, for display. */
                issue_key?: string | null;
                issue_title?: string | null;
                kind: string;
                payload: unknown;
                /** Format: date-time */
                read_at?: string | null;
                /** Format: uuid */
                work_item_id?: string | null;
            }[];
            next_cursor?: string | null;
        };
        Page_Report: {
            items: {
                attachments: components["schemas"]["AttachmentMeta"][];
                /** Format: uuid */
                author_id: string;
                body: string;
                /** Format: date-time */
                created_at: string;
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                issue_id: string;
                /** Format: date-time */
                submitted_at?: string | null;
                title: string;
                /** Format: date-time */
                updated_at: string;
                /** Format: int32 */
                version: number;
                /**
                 * Format: uuid
                 * @description `null` for a self-filed report.
                 */
                work_item_id?: string | null;
            }[];
            next_cursor?: string | null;
        };
        Page_Rsvp: {
            items: {
                first_name: string;
                last_name: string;
                note?: string | null;
                /** Format: date-time */
                responded_at?: string | null;
                response: components["schemas"]["RsvpResponse"];
                /** Format: uuid */
                user_id: string;
            }[];
            next_cursor?: string | null;
        };
        Page_WorkItem: {
            items: {
                /**
                 * Format: uuid
                 * @description Who holds the work now: does it, or (once it's handed in) waits for review.
                 */
                assignee_id?: string | null;
                /** Format: uuid */
                branch_id: string;
                /** Format: date-time */
                created_at: string;
                /** Format: date-time */
                decided_at?: string | null;
                /** Format: uuid */
                decided_by?: string | null;
                decision_note?: string | null;
                /**
                 * @description Everyone it was passed through, from the person first given it to
                 *     the holder. Empty if it was never passed on.
                 */
                handoff_chain: string[];
                /** Format: uuid */
                id: string;
                is_overdue: boolean;
                /** Format: uuid */
                issue_id: string;
                /**
                 * Format: uuid
                 * @description Who reviews the holder's hand-in: one level up the chain. `null`: the
                 *     item's sender and the branch's approvers.
                 */
                reviewer_id?: string | null;
                /** Format: date-time */
                sla_due_at?: string | null;
                status: components["schemas"]["WorkStatus"];
                /** Format: date-time */
                submitted_at?: string | null;
                /** Format: uuid */
                target_id: string;
                /** Format: date-time */
                updated_at: string;
                /** Format: int32 */
                version: number;
            }[];
            next_cursor?: string | null;
        };
        PassTicket: {
            /**
             * Format: uuid
             * @description Someone in the same branch who should answer instead.
             */
            user_id: string;
        };
        /** Format: password */
        Password: string;
        PasswordReset: {
            temporary_password: string;
        };
        /** @enum {string} */
        Permission: "issue.read" | "issue.create" | "issue.edit" | "issue.close" | "issue.target" | "issue.target_other_branches" | "work_item.update" | "work_item.assign" | "work_item.approve" | "comment.create" | "comment.internal" | "comment.moderate" | "member.view" | "member.manage" | "dashboard.branch" | "export.run";
        /** @enum {string} */
        Priority: "low" | "medium" | "high" | "critical";
        ProfilePatch: {
            email?: string | null;
            first_name?: string | null;
            last_name?: string | null;
        };
        /** @description What others see beside a person's name. */
        PublicProfile: {
            /**
             * @description Changes with every new picture: `GET /api/users/{id}/avatar?v=<avatar_version>`.
             *     `null`: no picture.
             */
            avatar_version?: string | null;
            bio?: string | null;
            /**
             * @description Changes with every new cover: `GET /api/users/{id}/cover?v=<cover_version>`.
             *     `null`: no cover.
             */
            cover_version?: string | null;
            /** Format: uuid */
            user_id: string;
        };
        /**
         * @description A person who can be sent a school-wide item, in one of their branches.
         *     Names only: this list reaches people outside the branch.
         */
        Recipient: {
            /** Format: uuid */
            branch_id: string;
            branch_name: string;
            first_name: string;
            last_name: string;
            /** Format: uuid */
            user_id: string;
        };
        RecipientGroup: {
            /** Format: uuid */
            branch_id: string;
            branch_name: string;
            /** Format: uuid */
            id: string;
            /** Format: int64 */
            member_count: number;
            name: string;
        };
        Report: {
            attachments: components["schemas"]["AttachmentMeta"][];
            /** Format: uuid */
            author_id: string;
            body: string;
            /** Format: date-time */
            created_at: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            issue_id: string;
            /** Format: date-time */
            submitted_at?: string | null;
            title: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: int32 */
            version: number;
            /**
             * Format: uuid
             * @description `null` for a self-filed report.
             */
            work_item_id?: string | null;
        };
        ReportPatch: {
            body?: string | null;
            title?: string | null;
            /** Format: int32 */
            version: number;
        };
        RowError: {
            code: string;
            message: string;
        };
        Rsvp: {
            first_name: string;
            last_name: string;
            note?: string | null;
            /** Format: date-time */
            responded_at?: string | null;
            response: components["schemas"]["RsvpResponse"];
            /** Format: uuid */
            user_id: string;
        };
        RsvpCounts: {
            /** Format: int64 */
            declined: number;
            /** Format: int64 */
            going: number;
            /** Format: int64 */
            maybe: number;
            /** Format: int64 */
            pending: number;
        };
        RsvpInput: {
            note?: string | null;
            response: components["schemas"]["RsvpResponse"];
        };
        RsvpPage: components["schemas"]["Page_Rsvp"] & {
            counts: components["schemas"]["RsvpCounts"];
        };
        /** @enum {string} */
        RsvpResponse: "pending" | "going" | "maybe" | "declined";
        /**
         * @description Scope of a grant (`permission_scope` in the schema).
         * @enum {string}
         */
        Scope: "own" | "targeted" | "branch";
        Settings: {
            school_name: string;
            /** Format: date-time */
            updated_at: string;
        };
        SettingsPatch: {
            school_name?: string | null;
        };
        SourcedGrant: {
            group: components["schemas"]["GroupRef"];
            issue_type?: string | null;
            permission: string;
            scope: components["schemas"]["Scope"];
        };
        StatusCounts: {
            /** Format: int64 */
            approved: number;
            /** Format: int64 */
            blocked: number;
            /** Format: int64 */
            cancelled: number;
            /** Format: int64 */
            in_progress: number;
            /** Format: int64 */
            open: number;
            /** Format: int64 */
            pending_approval: number;
        };
        TagCount: {
            /**
             * Format: int64
             * @description Issues the actor can see with this tag.
             */
            count: number;
            tag: string;
        };
        Target: {
            /** Format: uuid */
            branch_id: string;
            branch_name: string;
            /** Format: date-time */
            created_at: string;
            /** Format: uuid */
            group_id?: string | null;
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["TargetKind"];
            /**
             * @description What to call it: the person's full name, the group's ("All members"
             *     for a branch's default group) or the branch's. Readers of the issue
             *     may not see the other branches' people and groups.
             */
            name: string;
            /** Format: uuid */
            user_id?: string | null;
        };
        /**
         * @description A recipient: exactly one of `user_id`, `group_id` or `branch_id` (whole
         *     branch; super admins only), e.g. `{"group_id": "..."}`. On a cross-branch
         *     issue a person or group also names their branch: `{"user_id": "...",
         *     "branch_id": "..."}`, `{"group_id": "...", "branch_id": "..."}`. Anything
         *     else is `422 invalid_target`. Send one target per recipient.
         */
        TargetInput: {
            /** Format: uuid */
            branch_id?: string | null;
            /** Format: uuid */
            group_id?: string | null;
            /** Format: uuid */
            user_id?: string | null;
        };
        /** @enum {string} */
        TargetKind: "branch" | "group" | "user";
        Template: {
            /** Format: date-time */
            archived_at?: string | null;
            /** Format: date-time */
            created_at: string;
            /**
             * Format: int32
             * @description Default due time for its work; falls back to the type's.
             */
            default_sla_hours?: number | null;
            description?: string | null;
            /** @description Reserved for custom fields. */
            fields: Record<string, never>[];
            /** Format: uuid */
            id: string;
            name: string;
            /** Format: int32 */
            position: number;
            /** @description Actions only: each piece of work needs a submitted written report. */
            requires_report: boolean;
            /** @description Put on every issue made from it. */
            tag?: string | null;
            /** @description The type of the issues it makes. */
            type: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: int32 */
            version: number;
        };
        TemplatePatch: {
            /** @description `true` archives (hidden from new issues), `false` restores. */
            archived?: boolean | null;
            /** Format: int32 */
            default_sla_hours?: number | null;
            description?: string | null;
            name?: string | null;
            /** Format: int32 */
            position?: number | null;
            requires_report?: boolean | null;
            tag?: string | null;
            /**
             * Format: int32
             * @description The version the client last saw.
             */
            version: number;
        };
        /** @enum {string} */
        Transition: "start" | "block" | "unblock" | "submit" | "approve" | "reject" | "claim" | "assign" | "cancel" | "pass";
        TransitionInput: {
            /**
             * Format: uuid
             * @description Assign and pass only.
             */
            assignee_id?: string | null;
            /** @description Approve (optional) and reject (required). */
            note?: string | null;
            /**
             * Format: int32
             * @description The version the client last saw.
             */
            version: number;
        };
        TypeCounts: {
            /** Format: int64 */
            action: number;
            /** Format: int64 */
            event: number;
            /** Format: int64 */
            ticket: number;
        };
        UpcomingEvent: {
            /** Format: uuid */
            issue_id: string;
            key: string;
            my_rsvp?: components["schemas"]["RsvpResponse"] | null;
            /** Format: date-time */
            starts_at: string;
            title: string;
        };
        UserProfile: {
            /** @description `GET /api/users/{id}/avatar?v=<avatar_version>`; `null`: no picture. */
            avatar_version?: string | null;
            bio?: string | null;
            /** @description `GET /api/users/{id}/cover?v=<cover_version>`; `null`: no cover. */
            cover_version?: string | null;
            email: string;
            first_name: string;
            /** Format: uuid */
            id: string;
            is_super_admin: boolean;
            /** Format: date-time */
            last_login_at?: string | null;
            last_name: string;
            must_change_password: boolean;
        };
        VersionBody: {
            /** Format: int32 */
            version: number;
        };
        WorkItem: {
            /**
             * Format: uuid
             * @description Who holds the work now: does it, or (once it's handed in) waits for review.
             */
            assignee_id?: string | null;
            /** Format: uuid */
            branch_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            decided_at?: string | null;
            /** Format: uuid */
            decided_by?: string | null;
            decision_note?: string | null;
            /**
             * @description Everyone it was passed through, from the person first given it to
             *     the holder. Empty if it was never passed on.
             */
            handoff_chain: string[];
            /** Format: uuid */
            id: string;
            is_overdue: boolean;
            /** Format: uuid */
            issue_id: string;
            /**
             * Format: uuid
             * @description Who reviews the holder's hand-in: one level up the chain. `null`: the
             *     item's sender and the branch's approvers.
             */
            reviewer_id?: string | null;
            /** Format: date-time */
            sla_due_at?: string | null;
            status: components["schemas"]["WorkStatus"];
            /** Format: date-time */
            submitted_at?: string | null;
            /** Format: uuid */
            target_id: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: int32 */
            version: number;
        };
        /** @enum {string} */
        WorkStatus: "open" | "in_progress" | "blocked" | "pending_approval" | "approved" | "cancelled";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    get__api_attachments_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The file, as a download */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": unknown;
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_auth_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Signed in; sets the `sid` cookie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeResponse"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_auth_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed out */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_avatars: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AvatarRef"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_branches: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `next_cursor`. */
                after?: string;
                /** @description 1-200, default 50. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_Branch"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_branches: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewBranch"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Branch"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_branches_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Branch"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_branches_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BranchPatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Branch"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_branches_id_admins_user_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description User id */
                user_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_branches_id_admins_user_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description User id */
                user_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_branches_id_groups: {
        parameters: {
            query?: {
                after?: string;
                limit?: number;
                include_archived?: boolean;
            };
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_Group"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_branches_id_groups: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewGroup"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Group"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_branches_id_members: {
        parameters: {
            query?: {
                after?: string;
                limit?: number;
                include_left?: boolean;
                group_id?: string;
            };
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_Member"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_branches_id_members: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewMember"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AddedMember"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_branches_id_members_import: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        /** @description A `file` part (max 2 MB, at most 500 people) and optional `dry_run` and `skip_errors` fields */
        requestBody?: {
            content: {
                "multipart/form-data": unknown;
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportReport"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_branches_id_members_user_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description User id */
                user_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_branches_id_members_user_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description User id */
                user_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfilePatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_branches_id_members_user_id_effective_permissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description User id */
                user_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EffectivePermissions"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_calendar: {
        parameters: {
            query: {
                from: string;
                to: string;
                branch_id?: string;
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_CalendarEntry"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_comments_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_comments_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CommentPatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Comment"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_dashboard: {
        parameters: {
            query?: {
                branch_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Dashboard"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_directory: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DirectoryBranch"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_events_id_rsvp: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RsvpInput"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Rsvp"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_events_id_rsvps: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `next_cursor`. */
                after?: string;
                /** @description 1-200, default 50. */
                limit?: number;
            };
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RsvpPage"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_exports: {
        parameters: {
            query?: {
                branch_ids?: string;
                types?: string;
                from?: string;
                to?: string;
                /** @description The items list's filters: only issues in this state. */
                state?: components["schemas"]["IssueState"];
                /** @description Comma-separated: any of these priorities. */
                priority?: string;
                /** @description Comma-separated: issues with at least one of these tags. */
                tags?: string;
                /** @description Title contains this text. */
                q?: string;
                /**
                 * @description `created`: `from`/`to` are on when each issue was created, on every
                 *     sheet (as on the items list), not each sheet's main date.
                 */
                dates?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description An Excel workbook */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": unknown;
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_exports_people: {
        parameters: {
            query?: {
                /** @description Comma-separated; leave out for every branch. */
                branch_ids?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description An Excel workbook */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": unknown;
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_group_permissions_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_groups_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteOutcome"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_groups_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GroupPatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Group"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_groups_id_heads_user_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description User id */
                user_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_groups_id_heads_user_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description User id */
                user_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_groups_id_members_user_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description User id */
                user_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_groups_id_members_user_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description User id */
                user_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_groups_id_permissions: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `next_cursor`. */
                after?: string;
                /** @description 1-200, default 50. */
                limit?: number;
            };
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_GroupGrant"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_groups_id_permissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GrantChanges"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GroupGrant"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_groups_id_permissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewGrant"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GroupGrant"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_healthz: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The database is reachable */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_issues: {
        parameters: {
            query?: {
                after?: string;
                limit?: number;
                branch_id?: string;
                type?: string;
                state?: components["schemas"]["IssueState"];
                assignee?: string;
                q?: string;
                tag?: string;
                template_id?: string;
                /** @description Comma-separated: any of these priorities. */
                priority?: string;
                /** @description Comma-separated: issues with at least one of these tags. */
                tags?: string;
                /** @description Created at or after (RFC 3339). */
                from?: string;
                /** @description Created before (RFC 3339). */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_IssueSummary"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_issues: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewIssue"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssueDetail"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_issues_by_number_n_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Issue number, as in ISS-<n> */
                n: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssueDetail"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_issues_tags: {
        parameters: {
            query?: {
                branch_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagCount"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_issues_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssueDetail"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_issues_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IssuePatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssueDetail"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_issues_id_attachments: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        /** @description A `file` part (max 25 MB) and optional `comment_id` or `report_id` fields */
        requestBody?: {
            content: {
                "multipart/form-data": unknown;
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentMeta"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_issues_id_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VersionBody"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssueDetail"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_issues_id_close: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VersionBody"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssueDetail"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_issues_id_comments: {
        parameters: {
            query?: {
                after?: string;
                limit?: number;
                work_item_id?: string;
            };
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_Comment"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_issues_id_comments: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewComment"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Comment"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_issues_id_history: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `next_cursor`. */
                after?: string;
                /** @description 1-200, default 50. */
                limit?: number;
            };
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_HistoryEntry"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_issues_id_mute: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_issues_id_mute: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_issues_id_pass: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PassTicket"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssueDetail"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_issues_id_read: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_issues_id_reports: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `next_cursor`. */
                after?: string;
                /** @description 1-200, default 50. */
                limit?: number;
            };
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_Report"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_issues_id_reports: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewReport"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Report"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_issues_id_targets: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewTarget"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssueDetail"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_issues_id_targets_target_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                /** @description Target id */
                target_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssueDetail"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_issues_id_watch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_issues_id_watch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeResponse"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MyProfilePatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeResponse"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_me_avatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description A `file` part: JPEG, PNG or WebP, max 2 MB */
        requestBody?: {
            content: {
                "multipart/form-data": unknown;
            };
        };
        responses: {
            /** @description Saved */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_me_avatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_me_cover: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description A `file` part: JPEG, PNG or WebP, max 5 MB */
        requestBody?: {
            content: {
                "multipart/form-data": unknown;
            };
        };
        responses: {
            /** @description Saved */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_me_cover: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_me_password: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePasswordRequest"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_members_import_template: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description An Excel workbook */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": unknown;
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_notifications: {
        parameters: {
            query?: {
                unread?: boolean;
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_Notification"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_notifications_read_all: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description `{"marked": n}` */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_notifications_unread_count: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description `{"count": n}` */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_notifications_id_read: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Notification id */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_permissions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogEntry"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_recipient_groups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RecipientGroup"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_recipients: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Recipient"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_reports_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReportPatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Report"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_reports_id_submit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VersionBody"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Report"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_school_groups: {
        parameters: {
            query?: {
                include_archived?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Group"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_school_groups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewGroup"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Group"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_school_groups_id_copies: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Group"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_settings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Settings"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_settings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingsPatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Settings"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_stream: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description An SSE stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": unknown;
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_templates: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Super admins only. */
                include_archived: boolean;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Template"][];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_templates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewTemplate"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Template"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_templates_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TemplatePatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Template"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patch__api_users_id_active: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ActiveBody"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_users_id_avatar: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The image */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/*": unknown;
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_users_id_cover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The image */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/*": unknown;
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_users_id_profile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicProfile"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_users_id_reset_password: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PasswordReset"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    put__api_users_id_super_admin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete__api_users_id_super_admin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_work_items: {
        parameters: {
            query?: {
                after?: string;
                limit?: number;
                assignee?: string;
                status?: components["schemas"]["WorkStatus"];
                branch_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_WorkItem"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get__api_work_items_id_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkItem"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    post__api_work_items_id_transition_: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description id */
                id: string;
                transition: components["schemas"]["Transition"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TransitionInput"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkItem"];
                };
            };
            /** @description Error; see the codes in the README */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
