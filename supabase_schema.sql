-- Enable UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =================================================================================
-- 1. AUTHENTICATION / USERS TABLE
-- =================================================================================
-- NOTE: In a real Supabase app, you should use the built-in `auth.users` table
-- provided by Supabase Auth for secure password hashing and JWTs. 
-- However, as requested, here is a custom table to store and check login data manually.

CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, -- Store hashed passwords (e.g., bcrypt), never plain text!
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Example function to "check" login data (For reference/mocking only)
-- Usage: SELECT * FROM check_login('admin@college.edu', 'hashed_password_here');
CREATE OR REPLACE FUNCTION check_login(check_email TEXT, check_password TEXT)
RETURNS SETOF public.app_users AS $$
BEGIN
  RETURN QUERY 
  SELECT * FROM public.app_users 
  WHERE email = check_email AND password_hash = check_password
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;


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
