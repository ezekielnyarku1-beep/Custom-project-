BEGIN;

CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (btrim(name) <> ''),
    owner_id text NOT NULL CHECK (btrim(owner_id) <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_by_owner ON projects (owner_id);

CREATE TABLE areas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
    name text NOT NULL CHECK (btrim(name) <> ''),
    position integer NOT NULL CHECK (position >= 0),
    UNIQUE (project_id, position)
);

CREATE TABLE nodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
    parent_id uuid REFERENCES nodes ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('container', 'activity')),
    name text NOT NULL CHECK (btrim(name) <> ''),
    position integer NOT NULL CHECK (position >= 0),
    type text,
    priority text,
    CHECK (parent_id IS NOT NULL OR kind = 'container'),
    CHECK (
        (kind = 'container' AND type IS NULL AND priority IS NULL)
        OR (kind = 'activity'
            AND type IS NOT NULL AND type IN ('Existing', 'New')
            AND priority IS NOT NULL AND priority IN ('Must Have', 'Should Have', 'Nice to Have'))
    ),
    UNIQUE NULLS NOT DISTINCT (project_id, parent_id, position)
);
CREATE INDEX nodes_by_parent ON nodes (parent_id);

CREATE TABLE progress (
    node_id uuid NOT NULL REFERENCES nodes ON DELETE CASCADE,
    area_id uuid NOT NULL REFERENCES areas ON DELETE CASCADE,
    value integer NOT NULL DEFAULT 0 CHECK (value BETWEEN 0 AND 100),
    PRIMARY KEY (node_id, area_id)
);
CREATE INDEX progress_by_area ON progress (area_id);

-- Keep structural links fixed. Each child joins an existing container, so cycles cannot form.
CREATE FUNCTION check_node_structure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.id, NEW.project_id, NEW.parent_id, NEW.kind)
           IS DISTINCT FROM (OLD.id, OLD.project_id, OLD.parent_id, OLD.kind) THEN
            RAISE EXCEPTION 'A node cannot change its identity, project, parent or kind';
        END IF;
    ELSIF NEW.parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM nodes WHERE id = NEW.parent_id
        AND project_id = NEW.project_id AND kind = 'container'
    ) THEN
        RAISE EXCEPTION 'Choose a parent container from this project';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER node_structure BEFORE INSERT OR UPDATE OF id, project_id, parent_id, kind ON nodes
FOR EACH ROW EXECUTE FUNCTION check_node_structure();

CREATE FUNCTION keep_area_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'An area cannot move to another project';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER area_project BEFORE UPDATE OF project_id ON areas
FOR EACH ROW EXECUTE FUNCTION keep_area_project();

CREATE FUNCTION check_progress_pair() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM nodes n JOIN areas a ON a.project_id = n.project_id
        WHERE n.id = NEW.node_id AND a.id = NEW.area_id AND n.kind = 'activity'
    ) THEN
        RAISE EXCEPTION 'Progress needs an activity and an area from the same project';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER progress_pair BEFORE INSERT OR UPDATE OF node_id, area_id ON progress
FOR EACH ROW EXECUTE FUNCTION check_progress_pair();

-- Serialize area/activity creation in each project before filling missing pairs.
CREATE FUNCTION initialize_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM projects WHERE id = NEW.project_id FOR NO KEY UPDATE;
    IF TG_TABLE_NAME = 'areas' THEN
        INSERT INTO progress (node_id, area_id)
        SELECT id, NEW.id FROM nodes WHERE project_id = NEW.project_id AND kind = 'activity'
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO progress (node_id, area_id)
        SELECT NEW.id, id FROM areas WHERE project_id = NEW.project_id
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER new_area_progress AFTER INSERT ON areas
FOR EACH ROW EXECUTE FUNCTION initialize_progress();
CREATE TRIGGER new_activity_progress AFTER INSERT ON nodes
FOR EACH ROW WHEN (NEW.kind = 'activity') EXECUTE FUNCTION initialize_progress();

COMMIT;
