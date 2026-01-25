-- Create schema
CREATE SCHEMA IF NOT EXISTS vendinhas;

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Grant permissions
GRANT ALL ON SCHEMA vendinhas TO vendapp_user;
