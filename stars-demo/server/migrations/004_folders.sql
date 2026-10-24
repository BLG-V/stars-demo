CREATE TABLE IF NOT EXISTS folders (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  UNIQUE KEY folders_owner_name_uq (owner_id, name),
  INDEX folders_owner_updated_idx (owner_id, updated_at),
  CONSTRAINT folders_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS project_folders (
  project_id CHAR(36) PRIMARY KEY,
  folder_id CHAR(36) NOT NULL,
  assigned_at VARCHAR(32) NOT NULL,
  INDEX project_folders_folder_idx (folder_id),
  CONSTRAINT project_folders_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_folders_folder_fk FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
