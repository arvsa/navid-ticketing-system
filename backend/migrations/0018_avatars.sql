-- A profile picture, set by the person themselves, beside the cover. A file
-- in the attachment store under `avatars/<user>/<id>-<type>`; a new upload
-- replaces the old one.

ALTER TABLE app_user ADD COLUMN avatar_key text;
