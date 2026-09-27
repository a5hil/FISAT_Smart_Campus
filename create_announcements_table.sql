-- 1. Create Dedicated Announcements / Campus Notice Board Table
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

-- 2. Enable Row Level Security and allow full read/write for client
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON public.announcements;
CREATE POLICY "allow_all" ON public.announcements FOR ALL USING (true) WITH CHECK (true);

-- 3. Enable real-time updates for announcements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'announcements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
  END IF;
END $$;

-- 4. Migrate any legacy notices currently stored in notifications into announcements
INSERT INTO public.announcements (id, classroom_id, classroom_name, title, message, duration, is_active, created_at)
SELECT 
  id, 
  COALESCE(classroom_id, 'all'), 
  classroom_name, 
  title, 
  message, 
  CASE 
    WHEN type LIKE 'notice:%' THEN SPLIT_PART(type, ':', 2)
    ELSE '24h'
  END,
  true, 
  created_at
FROM public.notifications
WHERE type LIKE 'notice%'
ON CONFLICT (id) DO NOTHING;

-- 5. Clean up notices from notifications so it only contains device & system alerts
DELETE FROM public.notifications WHERE type LIKE 'notice%';
