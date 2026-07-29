CREATE TABLE IF NOT EXISTS org_content_categories (
  id UUID NOT NULL,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_actor_id TEXT NOT NULL,
  updated_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id, id),
  CHECK (CHAR_LENGTH(BTRIM(name)) BETWEEN 1 AND 120),
  CHECK (CHAR_LENGTH(description) <= 1000),
  CHECK (NOT is_default OR archived_at IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS org_content_categories_active_name_unique_idx
  ON org_content_categories (org_id, LOWER(BTRIM(name)))
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS org_content_categories_default_unique_idx
  ON org_content_categories (org_id)
  WHERE is_default = TRUE AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS org_content_categories_org_order_idx
  ON org_content_categories (org_id, archived_at, display_order, LOWER(name), id);

ALTER TABLE org_content_items
  ADD COLUMN IF NOT EXISTS category_id UUID NULL;

WITH content_orgs AS (
  SELECT DISTINCT org_id
  FROM org_content_items
),
default_rows AS (
  SELECT
    org_id,
    MD5('peritio-training-content-general:' || org_id) AS hash
  FROM content_orgs
)
INSERT INTO org_content_categories (
  id,
  org_id,
  name,
  description,
  display_order,
  is_default,
  created_by_actor_id,
  updated_by_actor_id
)
SELECT
  (
    SUBSTR(hash, 1, 8) || '-' ||
    SUBSTR(hash, 9, 4) || '-4' ||
    SUBSTR(hash, 14, 3) || '-8' ||
    SUBSTR(hash, 18, 3) || '-' ||
    SUBSTR(hash, 21, 12)
  )::UUID,
  org_id,
  'General',
  '',
  0,
  TRUE,
  'system:migration_010',
  'system:migration_010'
FROM default_rows
ON CONFLICT DO NOTHING;

UPDATE org_content_items item
SET category_id = category.id
FROM org_content_categories category
WHERE item.category_id IS NULL
  AND category.org_id = item.org_id
  AND category.is_default = TRUE
  AND category.archived_at IS NULL;

ALTER TABLE org_content_items
  ALTER COLUMN category_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'org_content_items'::regclass
      AND conname = 'org_content_items_category_fkey'
  ) THEN
    ALTER TABLE org_content_items
      ADD CONSTRAINT org_content_items_category_fkey
      FOREIGN KEY (org_id, category_id)
      REFERENCES org_content_categories (org_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END
$$;

ALTER TABLE org_content_items
  VALIDATE CONSTRAINT org_content_items_category_fkey;

CREATE INDEX IF NOT EXISTS org_content_items_org_category_order_idx
  ON org_content_items (
    org_id,
    category_id,
    publication_state,
    display_order,
    LOWER(title),
    id
  );
