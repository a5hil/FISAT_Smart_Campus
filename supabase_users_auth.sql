-- =================================================================================
-- FISAT SMART CAMPUS - USERS TABLE & DATABASE AUTHENTICATION SCHEMA
-- Run this in your Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- =================================================================================

-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Drop legacy table if it was created with old column structure
DROP TABLE IF EXISTS public.app_users CASCADE;

-- 3. Create the clean `app_users` table
CREATE TABLE public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'Department Administrator',
  department TEXT DEFAULT 'IMCA Department',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Case-insensitive lookup indexes for fast username & email login
CREATE INDEX idx_app_users_username ON public.app_users (LOWER(username));
CREATE INDEX idx_app_users_email ON public.app_users (LOWER(email));

-- 5. Enable Row Level Security (RLS) & Policies
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read access for login" ON public.app_users;
CREATE POLICY "Allow anon read access for login"
  ON public.app_users
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow anon insert for signup" ON public.app_users;
CREATE POLICY "Allow anon insert for signup"
  ON public.app_users
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update" ON public.app_users;
CREATE POLICY "Allow anon update"
  ON public.app_users
  FOR UPDATE
  USING (true);

-- 6. RPC Function to Securely Verify User Credentials (Username or Email + Password)
CREATE OR REPLACE FUNCTION verify_user_login(p_identifier TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  username TEXT,
  email TEXT,
  name TEXT,
  role TEXT,
  department TEXT,
  created_at TIMESTAMP WITH TIME ZONE
) 
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.username,
    u.email,
    u.name,
    u.role,
    u.department,
    u.created_at
  FROM public.app_users u
  WHERE (LOWER(u.username) = LOWER(TRIM(p_identifier)) OR LOWER(u.email) = LOWER(TRIM(p_identifier)))
    AND u.password = p_password
    AND u.is_active = true
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Grant execution permission on verify_user_login to anon & authenticated roles
GRANT EXECUTE ON FUNCTION verify_user_login(TEXT, TEXT) TO anon, authenticated, service_role;

-- 7. Insert Initial Seed Users with Passwords
INSERT INTO public.app_users (username, email, password, name, role, department, is_active)
VALUES 
  (
    'admin',
    'admin@fisat.ac.in',
    'admin123',
    'Nershel Nelson',
    'Department Administrator',
    'IMCA Department',
    true
  ),
  (
    'faculty',
    'faculty@fisat.ac.in',
    'faculty123',
    'Dr. Arun Kumar',
    'Associate Professor',
    'Computer Applications',
    true
  ),
  (
    'labincharge',
    'lab@fisat.ac.in',
    'lab123',
    'Priya Varghese',
    'Lab Technical Officer',
    'IoT & Embedded Systems Lab',
    true
  ),
  (
    'student',
    'student@fisat.ac.in',
    'student123',
    'Rahul S',
    'Student Representative',
    'MCA Semester 4',
    true
  );

-- Quick Verification Test:
-- SELECT * FROM verify_user_login('admin', 'admin123');
