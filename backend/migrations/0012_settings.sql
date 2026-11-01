-- App settings the super admin runs: one row. The school's name shows in
-- the header and on the sign-in page.

CREATE TABLE app_settings (
    id           boolean     PRIMARY KEY DEFAULT true CHECK (id),
    school_name  text        NOT NULL DEFAULT 'Navid Schools'
                             CHECK (length(btrim(school_name)) BETWEEN 1 AND 120),
    updated_by   uuid        REFERENCES app_user (id),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings DEFAULT VALUES;
