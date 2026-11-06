-- A personal touch on profiles: a short bio and a cover image, each set by
-- the person themselves. The cover is a file in the attachment store under
-- `covers/<user>/<id>`; a new upload replaces the old one.

ALTER TABLE app_user
    ADD COLUMN bio       text CHECK (length(bio) BETWEEN 1 AND 500),
    ADD COLUMN cover_key text;
