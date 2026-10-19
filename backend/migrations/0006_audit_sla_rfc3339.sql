-- Work-item `create` audit rows wrote `sla_due_at` with serde's default
-- `OffsetDateTime` form, [year, day_of_year, hour, minute, second,
-- nanosecond, offset_hours, offset_minutes, offset_seconds], instead of
-- RFC 3339. Rewrite them as the same instant in RFC 3339 (UTC, as
-- `time::serde::rfc3339` writes it). This repairs the format only, so the
-- append-only trigger is lifted for this one statement.

ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only;

UPDATE audit_log a
SET new_value = jsonb_set(a.new_value, '{sla_due_at}', to_jsonb(
        to_char(t.at, 'YYYY-MM-DD"T"HH24:MI:SS')
        || CASE WHEN t.nanos = 0 THEN '' ELSE '.' || rtrim(lpad(t.nanos::text, 9, '0'), '0') END
        || 'Z'))
FROM (
    SELECT id,
           (make_date((v->>0)::int, 1, 1) + ((v->>1)::int - 1))::timestamp
               + make_interval(hours => (v->>2)::int, mins => (v->>3)::int, secs => (v->>4)::int)
               - make_interval(hours => (v->>6)::int, mins => (v->>7)::int, secs => (v->>8)::int) AS at,
           (v->>5)::bigint AS nanos
    FROM (SELECT id, new_value->'sla_due_at' AS v FROM audit_log
          WHERE entity_type = 'work_item' AND jsonb_typeof(new_value->'sla_due_at') = 'array') raw
) t
WHERE a.id = t.id;

ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only;
