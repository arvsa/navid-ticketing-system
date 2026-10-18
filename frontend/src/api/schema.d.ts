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
        /** GET /api/exports?branch_ids=&types=ticket,report,event,action&from=&to= */
        get: operations["get__api_exports"];
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
        put?: never;
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
             * @description Open, non-private tickets the actor can see. Always present.
             */
            open_public_tickets: number;
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
            is_private: boolean;
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
        Group: {
            /** Format: date-time */
            archived_at?: string | null;
            /** Format: uuid */
            branch_id: string;
            /** Format: date-time */
            created_at: string;
            description?: string | null;
            /** Format: uuid */
            id: string;
            is_default: boolean;
            /** Format: int64 */
            member_count: number;
            name: string;
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
            name?: string | null;
        };
        GroupRef: {
            /** Format: uuid */
            id: string;
            name: string;
        };
        HistoryEntry: {
            action: string;
            /** Format: uuid */
            actor_id?: string | null;
            /** Format: date-time */
            created_at: string;
            entity_id: string;
            entity_type: string;
            /** Format: int64 */
            id: number;
            new_value?: unknown;
            old_value?: unknown;
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
            description?: string | null;
            event?: components["schemas"]["EventView"] | null;
            /** Format: uuid */
            id: string;
            is_private: boolean;
            key: string;
            /** Format: date-time */
            last_read_at?: string | null;
            /** Format: int64 */
            number: number;
            priority: components["schemas"]["Priority"];
            requires_super_admin_approval: boolean;
            state: components["schemas"]["IssueState"];
            targets: components["schemas"]["Target"][];
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
            is_private?: boolean | null;
            priority?: components["schemas"]["Priority"] | null;
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
            /** Format: int64 */
            done_count: number;
            /** Format: uuid */
            id: string;
            is_overdue: boolean;
            is_private: boolean;
            /** @description Display form, `ISS-<number>`. */
            key: string;
            /** Format: date-time */
            last_activity_at: string;
            /** Format: int64 */
            number: number;
            priority: components["schemas"]["Priority"];
            state: components["schemas"]["IssueState"];
            title: string;
            type: string;
            /** @description Activity since the actor last opened the issue. */
            unread: boolean;
            /** Format: int64 */
            work_item_count: number;
        };
        /**
         * @description The four issue types (`issue_type.code`).
         * @enum {string}
         */
        IssueType: "ticket" | "report" | "event" | "action";
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
        NewBranch: {
            code: string;
            email?: string | null;
            /** Format: uuid */
            first_admin_user_id: string;
            name: string;
            timezone: string;
        };
        NewComment: {
            body: string;
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
            name: string;
        };
        NewIssue: {
            /**
             * Format: uuid
             * @description `null` = cross-branch (super admins, whole-branch targets only).
             */
            branch_id?: string | null;
            completion_mode?: components["schemas"]["CompletionMode"];
            description?: string | null;
            event?: components["schemas"]["EventInput"] | null;
            is_private?: boolean;
            priority?: components["schemas"]["Priority"];
            /**
             * Format: date-time
             * @description Actions and Reports only; defaults to now + the type's default SLA.
             */
            sla_due_at?: string | null;
            targets?: components["schemas"]["TargetInput"][];
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
                is_private: boolean;
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
                /** Format: uuid */
                branch_id: string;
                /** Format: date-time */
                created_at: string;
                description?: string | null;
                /** Format: uuid */
                id: string;
                is_default: boolean;
                /** Format: int64 */
                member_count: number;
                name: string;
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
                /** Format: uuid */
                actor_id?: string | null;
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
                /** Format: int64 */
                done_count: number;
                /** Format: uuid */
                id: string;
                is_overdue: boolean;
                is_private: boolean;
                /** @description Display form, `ISS-<number>`. */
                key: string;
                /** Format: date-time */
                last_activity_at: string;
                /** Format: int64 */
                number: number;
                priority: components["schemas"]["Priority"];
                state: components["schemas"]["IssueState"];
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
                /** Format: uuid */
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
                /** Format: uuid */
                id: string;
                is_overdue: boolean;
                /** Format: uuid */
                issue_id: string;
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
        /** Format: password */
        Password: string;
        PasswordReset: {
            temporary_password: string;
        };
        /** @enum {string} */
        Permission: "issue.read" | "issue.read_private" | "issue.create" | "issue.edit" | "issue.close" | "issue.set_private" | "issue.target" | "work_item.update" | "work_item.assign" | "work_item.approve" | "comment.create" | "comment.internal" | "comment.moderate" | "member.view" | "member.manage" | "dashboard.branch" | "export.run";
        /** @enum {string} */
        Priority: "low" | "medium" | "high" | "critical";
        ProfilePatch: {
            email?: string | null;
            first_name?: string | null;
            last_name?: string | null;
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
        Target: {
            /** Format: uuid */
            branch_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: uuid */
            group_id?: string | null;
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["TargetKind"];
            /** Format: uuid */
            user_id?: string | null;
        };
        /** @description `{user_id}`, `{group_id}` or `{branch_id}` (super admins only). */
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
        TransitionInput: {
            /**
             * Format: uuid
             * @description Assign only.
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
            report: number;
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
            /** Format: uuid */
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
            /** Format: uuid */
            id: string;
            is_overdue: boolean;
            /** Format: uuid */
            issue_id: string;
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
        /** @enum {string} */
        Transition: "start" | "block" | "unblock" | "submit" | "approve" | "reject" | "claim" | "assign" | "cancel";
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
