CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) PRIMARY KEY,
  token CHAR(64) NOT NULL UNIQUE,
  user_id CHAR(36) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  INDEX sessions_user_idx (user_id),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  initial_prompt VARCHAR(4000) NOT NULL,
  status VARCHAR(24) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  deleted_at VARCHAR(32) NULL,
  INDEX projects_owner_updated_idx (owner_id, updated_at),
  CONSTRAINT projects_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS project_files (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  path VARCHAR(180) NOT NULL,
  content LONGTEXT NOT NULL,
  content_hash VARCHAR(128) NOT NULL,
  updated_by_run_id CHAR(36) NULL,
  updated_at VARCHAR(32) NOT NULL,
  UNIQUE KEY files_project_path_uq (project_id, path),
  INDEX files_project_idx (project_id),
  CONSTRAINT files_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  run_id CHAR(36) NULL,
  created_at VARCHAR(32) NOT NULL,
  INDEX messages_project_created_idx (project_id, created_at),
  CONSTRAINT messages_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS agent_runs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL,
  model VARCHAR(120) NOT NULL,
  prompt_hash VARCHAR(128) NOT NULL,
  error_code VARCHAR(80) NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  INDEX runs_project_created_idx (project_id, created_at),
  CONSTRAINT runs_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS snapshots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  manifest JSON NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  INDEX snapshots_project_created_idx (project_id, created_at),
  CONSTRAINT snapshots_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT snapshots_user_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS file_changes (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  path VARCHAR(180) NOT NULL,
  operation VARCHAR(16) NOT NULL,
  content_hash VARCHAR(128) NOT NULL,
  diff_summary VARCHAR(500) NOT NULL,
  INDEX file_changes_run_idx (run_id),
  INDEX file_changes_run_path_idx (run_id, path),
  CONSTRAINT file_changes_run_fk FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
