BEGIN;
ALTER TABLE nodes ADD COLUMN description text NOT NULL DEFAULT '', ADD COLUMN checklist jsonb NOT NULL DEFAULT '[]';
CREATE TABLE attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 node_id uuid NOT NULL REFERENCES nodes ON DELETE CASCADE,
 name text NOT NULL,
 content bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE saved_views (
 account_id uuid REFERENCES accounts ON DELETE CASCADE,
 workspace_id uuid REFERENCES workspaces ON DELETE CASCADE,
 name text NOT NULL,
 filters jsonb NOT NULL,
 PRIMARY KEY(account_id,workspace_id,name)
);
COMMIT;
