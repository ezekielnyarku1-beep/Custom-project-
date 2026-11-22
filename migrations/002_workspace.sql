BEGIN;
CREATE TABLE accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE,
 name text NOT NULL,
 password_hash text NOT NULL,
 job_title text NOT NULL DEFAULT '',
 in_app boolean NOT NULL DEFAULT true,
 email_alerts boolean NOT NULL DEFAULT false
);
CREATE TABLE workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL,
 project_key text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text
);
CREATE TABLE members (
 workspace_id uuid REFERENCES workspaces ON DELETE CASCADE,
 account_id uuid REFERENCES accounts ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('Owner','Manager','Member')),
 PRIMARY KEY(workspace_id,account_id)
);
CREATE TABLE sessions (
 token text PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days'
);
CREATE TABLE invitations (
 token text PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
 email text NOT NULL,
 role text NOT NULL CHECK(role IN ('Manager','Member')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 UNIQUE(workspace_id,email)
);
CREATE TABLE password_resets (
 account_id uuid PRIMARY KEY REFERENCES accounts ON DELETE CASCADE,
 token text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
ALTER TABLE projects ADD COLUMN description text NOT NULL DEFAULT '', ADD COLUMN due_date date;
ALTER TABLE nodes ADD COLUMN stage text NOT NULL DEFAULT 'To do' CHECK(stage IN ('To do','In progress','In review','Done')), ADD COLUMN assignee uuid REFERENCES accounts, ADD COLUMN due_date date;
UPDATE nodes n SET stage = CASE WHEN s.minimum=100 THEN 'Done' ELSE 'In progress' END
FROM (SELECT node_id,min(value) minimum FROM progress GROUP BY node_id HAVING max(value)>0) s WHERE n.id=s.node_id;
CREATE TABLE project_members (
 project_id uuid REFERENCES projects ON DELETE CASCADE,
 account_id uuid REFERENCES accounts ON DELETE CASCADE,
 PRIMARY KEY(project_id,account_id)
);
CREATE TABLE stars (
 project_id uuid REFERENCES projects ON DELETE CASCADE,
 account_id uuid REFERENCES accounts ON DELETE CASCADE,
 PRIMARY KEY(project_id,account_id)
);
CREATE TABLE events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
 node_id uuid REFERENCES nodes ON DELETE SET NULL,
 actor uuid NOT NULL REFERENCES accounts,
 kind text NOT NULL,
 message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_project ON events(project_id,id DESC);
CREATE TABLE notifications (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id bigint NOT NULL REFERENCES events ON DELETE CASCADE,
 recipient uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
 kind text NOT NULL,
 seen boolean NOT NULL DEFAULT false
);
CREATE INDEX notifications_recipient ON notifications(recipient,id DESC);
CREATE TABLE mail_queue (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 recipient text NOT NULL,
 subject text NOT NULL,
 body text NOT NULL,
 next_attempt timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0
);
COMMIT;
