-- Enable UUID generation and pgcrypto
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =================================================================================
-- 1. AUTHENTICATION / USERS TABLE & CREDENTIALS VERIFICATION
-- =================================================================================

-- Drop legacy table if it was created with old column structure
DROP TABLE IF EXISTS public.app_users CASCADE;

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

CREATE INDEX idx_app_users_username ON public.app_users (LOWER(username));
CREATE INDEX idx_app_users_email ON public.app_users (LOWER(email));

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read access for login" ON public.app_users;
CREATE POLICY "Allow anon read access for login" ON public.app_users FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow anon insert for signup" ON public.app_users;
CREATE POLICY "Allow anon insert for signup" ON public.app_users FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update" ON public.app_users;
CREATE POLICY "Allow anon update" ON public.app_users FOR UPDATE USING (true);

-- RPC Function to verify login with either username or email
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

GRANT EXECUTE ON FUNCTION verify_user_login(TEXT, TEXT) TO anon, authenticated, service_role;

-- Seed default demo users
INSERT INTO public.app_users (username, email, password, name, role, department, is_active)
VALUES 
  ('admin', 'admin@fisat.ac.in', 'admin123', 'Nershel Nelson', 'Department Administrator', 'IMCA Department', true),
  ('faculty', 'faculty@fisat.ac.in', 'faculty123', 'Dr. Arun Kumar', 'Associate Professor', 'Computer Applications', true),
  ('labincharge', 'lab@fisat.ac.in', 'lab123', 'Priya Varghese', 'Lab Technical Officer', 'IoT & Embedded Systems Lab', true),
  ('student', 'student@fisat.ac.in', 'student123', 'Rahul S', 'Student Representative', 'MCA Semester 4', true)
ON CONFLICT (username) DO UPDATE 
SET 
  email = EXCLUDED.email,
  password = EXCLUDED.password,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  department = EXCLUDED.department,
  updated_at = NOW();


-- =================================================================================
-- 2. SMART CLASSROOM MOCK DATA TABLES
-- =================================================================================

-- Campuses
CREATE TABLE IF NOT EXISTS public.campuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  department TEXT,
  buildings TEXT[] -- Array of building names
);

-- Classrooms
CREATE TABLE IF NOT EXISTS public.classrooms (
  id TEXT PRIMARY KEY, -- Using TEXT to match your mockData string IDs (e.g. 'cls-101')
  name TEXT NOT NULL,
  room_number TEXT NOT NULL,
  department TEXT,
  building TEXT,
  floor TEXT,
  capacity INT,
  occupancy_status TEXT DEFAULT 'vacant', -- 'vacant' or 'occupied'
  status TEXT DEFAULT 'offline',          -- 'online' or 'offline'
  temperature FLOAT DEFAULT 24.0,
  current_load FLOAT DEFAULT 0.0,
  energy_today FLOAT DEFAULT 0.0,
  estimated_cost FLOAT DEFAULT 0.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Controllers (ESP32 / Hardware Units)
CREATE TABLE IF NOT EXISTS public.controllers (
  id TEXT PRIMARY KEY,
  classroom_id TEXT REFERENCES public.classrooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'ESP32-WROOM',
  status TEXT DEFAULT 'offline',
  signal_strength TEXT DEFAULT 'medium',
  ip_address TEXT,
  mac_address TEXT,
  firmware_version TEXT,
  relay_channels INT DEFAULT 8,
  used_channels INT[] DEFAULT '{}',
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Devices (Lights, Fans, ACs, etc.)
CREATE TABLE IF NOT EXISTS public.devices (
  id TEXT PRIMARY KEY,
  classroom_id TEXT REFERENCES public.classrooms(id) ON DELETE CASCADE,
  controller_id TEXT REFERENCES public.controllers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- 'light', 'fan', 'ac', 'projector', etc.
  status TEXT DEFAULT 'off',
  relay_channel INT NOT NULL,
  room_area TEXT,
  capabilities JSONB DEFAULT '{"power": true}'::jsonb,
  settings JSONB DEFAULT '{}'::jsonb,
  power_usage FLOAT DEFAULT 0.0,
  energy_today FLOAT DEFAULT 0.0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Alerts
CREATE TABLE IF NOT EXISTS public.alerts (
  id TEXT PRIMARY KEY,
  classroom_id TEXT REFERENCES public.classrooms(id) ON DELETE CASCADE,
  classroom_name TEXT,
  severity TEXT NOT NULL, -- 'info', 'warning', 'critical'
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  classroom_id TEXT REFERENCES public.classrooms(id) ON DELETE CASCADE,
  classroom_name TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Activity (recent actions per classroom)
CREATE TABLE IF NOT EXISTS public.activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id TEXT REFERENCES public.classrooms(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  "user" TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Announcements / Campus Digital Notice Board
CREATE TABLE IF NOT EXISTS public.announcements (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL DEFAULT 'all',
  classroom_name TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  duration TEXT DEFAULT '24h',
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
