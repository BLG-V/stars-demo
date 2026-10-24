CREATE TABLE IF NOT EXISTS email_verifications (
  email VARCHAR(254) PRIMARY KEY,
  code_hash CHAR(64) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  consumed_at VARCHAR(32) NULL,
  sent_at VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
