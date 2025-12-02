-- Drop credentials schema after migration to Vault
-- This removes the old encryption-based credential storage

DROP TABLE IF EXISTS credentials.services;
DROP FUNCTION IF EXISTS credentials.update_updated_at();
DROP SCHEMA IF EXISTS credentials;
