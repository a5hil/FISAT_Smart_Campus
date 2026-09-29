import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  User, Campus, Classroom, Device, Controller, Alert, NotificationItem, ActivityItem, EnergyReading,
  DeviceCategory, DeviceStatus, DeviceCapability, ClassroomStatus, OccupancyStatus, AlertSeverity, NotificationType,
  ESP32Telemetry, NoticeItem, NoticeDuration, TimetableConfig, TimetablePeriod, BellPattern,
} from '../types';
import {
  mockUser, mockCampus, mockClassrooms, mockAlerts, mockNotifications, mockEnergyData, devsA101, defaultTimetable,
} from '../mock_data/mockData';
import { ThemeMode, ThemeColors, DarkColors, LightColors } from '../constants/colors';

interface QuickControls {
  allLights: boolean;
  allFans: boolean;
  allCurtains: boolean;
}

interface ToastState {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface AppContextType {
  user: User;
  campus: Campus;
  classrooms: Classroom[];
  alerts: Alert[];
  notifications: NotificationItem[];
  energyData: { hourly: EnergyReading[]; daily: EnergyReading[]; weekly: EnergyReading[] };
  quickControls: QuickControls;
  toast: ToastState | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  hideToast: () => void;
  toggleDevice: (classroomId: string, deviceId: string) => void;
  toggleQuickControl: (control: keyof QuickControls) => void;
  emergencyOff: () => void;
  addClassroom: (classroom: Classroom) => void;
  addDevice: (classroomId: string, device: Device) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  deleteNotification: (id: string) => void;
  clearAllNotifications: () => void;
  dismissAlert: (id: string) => void;
  updateDeviceValue: (classroomId: string, deviceId: string, updates: Partial<Device>) => void;
  updateDeviceRatedPower: (classroomId: string, deviceId: string, ratedWatts: number) => Promise<void>;
  esp32Ip: string;
  setEsp32Ip: (ip: string) => Promise<void>;
  esp32Connected: boolean;
  esp32Telemetry: ESP32Telemetry | null;
  systemMode: 'auto' | 'manual';
  setSystemMode: (mode: 'auto' | 'manual') => Promise<void>;
  syncWithEsp32: () => Promise<boolean>;
  toggleEsp32Mode: () => Promise<void>;
  updateEsp32WiFi: (ssid: string, password: string) => Promise<{ success: boolean; message: string }>;
  notices: NoticeItem[];
  addNotice: (notice: Omit<NoticeItem, 'id' | 'createdAt' | 'isActive'>) => Promise<boolean>;
  deleteNotice: (id: string) => Promise<boolean>;
  timetable: TimetableConfig;
  updateTimetable: (config: TimetableConfig) => Promise<void>;
  triggerBellTest: (pattern?: BellPattern) => Promise<{ success: boolean; message: string }>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  isDark: boolean;
  colors: ThemeColors;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const categoryMap: Record<keyof QuickControls, string> = {
  allLights: 'light',
  allFans: 'fan',
  allCurtains: 'curtain',
};

const STORAGE_KEYS = {
  CLASSROOMS: '@classrooms',
  ALERTS: '@alerts',
  NOTIFICATIONS: '@notifications',
  QUICK_CONTROLS: '@quickControls',
  ESP32_IP: '@esp32_ip',
  SYSTEM_MODE: '@system_mode',
  NOTICES: '@notices',
  TIMETABLE: '@timetable',
  THEME_MODE: '@theme_mode',
};

const SETTING_KEYS = ['brightness', 'speed', 'temperature', 'mode', 'fanSpeed', 'volume', 'source', 'direction', 'colorTemp'] as const;

function deviceSettings(dev: Device): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  const record = dev as unknown as Record<string, unknown>;
  for (const k of SETTING_KEYS) {
    if (record[k] !== undefined) s[k] = record[k];
  }
  return s;
}

// ─── ESP32 Hardware Integration Helpers ──────────────────────────────
function mapDeviceToEsp32Code(classroomId: string, device: Device): string {
  const isC1 = classroomId.includes('101') || classroomId === 'cls-a101';
  const isC2 = classroomId.includes('102') || classroomId === 'cls-a102';
  const isCorr = classroomId.includes('corr') || classroomId === 'cls-corridor';

  if (isCorr) {
    return device.id.includes('2') ? 'cr2' : 'cr1';
  }
  if (isC2) {
    if (device.category === 'light') return 'l2';
    if (device.category === 'fan') return 'f2';
    if (device.category === 'curtain') return 'c2';
  }
  if (isC1) {
    if (device.id.includes('notice') || device.name.toLowerCase().includes('notice')) return 'nb';
    if (device.id.includes('screen') || device.name.toLowerCase().includes('screen')) return 'ss';
    if (device.category === 'light') return 'l1';
    if (device.category === 'fan') return 'f1';
    if (device.category === 'curtain') return 'c1';
  }
  return isC2 ? 'l2' : 'l1';
}

async function sendEsp32Command(ip: string, dev: string, st: boolean) {
  if (!ip || ip.trim() === '') return;
  const cleanIp = ip.trim();
  const baseUrl = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;
  const url = `${baseUrl}/ctrl?dev=${encodeURIComponent(dev)}&st=${st ? '1' : '0'}&force=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    await fetch(url, { signal: controller.signal });
  } catch (e) {
    // Non-intrusive logging - gracefully handles offline controllers or simulation mode
    console.log(`[ESP32 Sync] Direct LAN command to ${cleanIp} (${dev}=${st}):`, (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Supabase row types ──────────────────────────────────────────────
interface CampusRow { id: string; name: string; department: string; buildings: string[] | null; }
interface ClassroomRow {
  id: string; name: string; room_number: string; department: string; building: string; floor: string;
  capacity: number; occupancy_status: string; status: string; temperature: number; current_load: number;
  energy_today: number; estimated_cost: number;
}
interface ControllerRow {
  id: string; classroom_id: string; name: string; type: string; status: string; signal_strength: string;
  ip_address: string | null; firmware_version: string | null; relay_channels: number | null;
  used_channels: number[] | null; last_seen: string;
}
interface DeviceRow {
  id: string; classroom_id: string; controller_id: string; name: string; category: string; status: string;
  relay_channel: number; room_area: string; capabilities: Record<string, boolean> | null;
  settings: Record<string, unknown> | null; power_usage: number; energy_today: number; last_updated: string;
}
interface AlertRow {
  id: string; classroom_id: string | null; classroom_name: string | null; severity: string;
  message: string; is_read: boolean; created_at: string;
}
interface NotificationRow {
  id: string; type: string; title: string; message: string; classroom_id: string | null;
  classroom_name: string | null; is_read: boolean; created_at: string;
}
interface AnnouncementRow {
  id: string;
  classroom_id: string;
  classroom_name?: string | null;
  title: string;
  message: string;
  duration?: string | null;
  expires_at?: string | null;
  is_active?: boolean;
  created_at: string;
}
interface ActivityRow { id: string; classroom_id: string | null; action: string; user: string; created_at: string; }

function mapCampus(row: CampusRow): Campus {
  return { name: row.name, department: row.department, buildings: row.buildings ?? [] };
}

function mapController(row: ControllerRow): Controller {
  return {
    id: row.id, name: row.name, type: row.type, status: row.status as Controller['status'],
    signalStrength: row.signal_strength as Controller['signalStrength'],
    relayChannels: row.relay_channels ?? 8, usedChannels: row.used_channels ?? [],
    ipAddress: row.ip_address ?? '', firmwareVersion: row.firmware_version ?? '',
    lastSeen: row.last_seen,
  };
}

function mapDevice(row: DeviceRow): Device {
  const defaultRated = row.category === 'fan' ? 75 : row.category === 'light' ? 60 : 40;
  const settings = (row.settings as Record<string, unknown>) || {};
  const rated = typeof settings.ratedPower === 'number'
    ? settings.ratedPower
    : (row.power_usage > 0 ? row.power_usage : defaultRated);
  return {
    id: row.id, name: row.name, category: row.category as DeviceCategory,
    status: row.status as DeviceStatus, controllerId: row.controller_id,
    relayChannel: row.relay_channel, roomArea: row.room_area,
    capabilities: (row.capabilities as DeviceCapability | null) ?? { power: true },
    powerUsage: row.status === 'on' ? rated : 0,
    ratedPower: rated,
    energyToday: row.energy_today, lastUpdated: row.last_updated,
    ...settings,
  };
}

function mapAlert(row: AlertRow): Alert {
  return {
    id: row.id, classroomId: row.classroom_id ?? '', classroomName: row.classroom_name ?? '',
    severity: row.severity as AlertSeverity, message: row.message,
    time: row.created_at, isRead: row.is_read,
  };
}

function mapNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id, type: row.type as NotificationType, title: row.title, message: row.message,
    classroomId: row.classroom_id ?? undefined, classroomName: row.classroom_name ?? undefined,
    time: row.created_at, isRead: row.is_read,
  };
}

function mapActivity(row: ActivityRow): ActivityItem {
  return {
    id: row.id, action: row.action, user: row.user, time: row.created_at,
    classroomId: row.classroom_id ?? undefined,
  };
}

function buildClassrooms(
  classroomRows: ClassroomRow[],
  controllerRows: ControllerRow[],
  deviceRows: DeviceRow[],
  alertRows: AlertRow[],
  activityRows: ActivityRow[],
): Classroom[] {
  const controllersByClass = new Map<string, Controller>();
  for (const r of controllerRows) controllersByClass.set(r.classroom_id, mapController(r));

  const devicesByClass = new Map<string, Device[]>();
  for (const r of deviceRows) {
    if (r.id === 'dev-system-mode') continue;
    const list = devicesByClass.get(r.classroom_id) ?? [];
    list.push(mapDevice(r));
    devicesByClass.set(r.classroom_id, list);
  }

  // Ensure Classroom A101 includes Notice Board and Smart Screen devices
  const c1Devs = devicesByClass.get('cls-a101') ?? [];
  const missingA101Devs = devsA101.filter(
    d => (d.id === 'dev-a101-notice-board' || d.id === 'dev-a101-smart-screen') &&
         !c1Devs.some(existing => existing.id === d.id)
  );
  if (missingA101Devs.length > 0) {
    devicesByClass.set('cls-a101', [...c1Devs, ...missingA101Devs]);
  }

  const alertsByClass = new Map<string, Alert[]>();
  for (const r of alertRows) {
    if (!r.classroom_id) continue;
    const list = alertsByClass.get(r.classroom_id) ?? [];
    list.push(mapAlert(r));
    alertsByClass.set(r.classroom_id, list);
  }

  const activityByClass = new Map<string, ActivityItem[]>();
  for (const r of activityRows) {
    if (!r.classroom_id) continue;
    const list = activityByClass.get(r.classroom_id) ?? [];
    list.push(mapActivity(r));
    activityByClass.set(r.classroom_id, list);
  }

  return classroomRows.map((r) => {
    const devs = devicesByClass.get(r.id) ?? [];
    const activeDevLoad = devs.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);
    const initialLoad = r.id === 'cls-a101' ? (r.current_load || activeDevLoad) : activeDevLoad;
    return {
      id: r.id, name: r.name, number: r.room_number, department: r.department,
      building: r.building, floor: r.floor, capacity: r.capacity,
      occupancy: r.occupancy_status as OccupancyStatus, status: r.status as ClassroomStatus,
      temperature: r.temperature, currentLoad: initialLoad, energyToday: r.energy_today,
      estimatedCost: r.estimated_cost,
      controller: controllersByClass.get(r.id) ?? {
        id: '', name: '', type: '', status: 'offline', signalStrength: 'weak',
        relayChannels: 8, usedChannels: [], ipAddress: '', firmwareVersion: '', lastSeen: new Date().toISOString(),
      },
      devices: devs,
      alerts: alertsByClass.get(r.id) ?? [],
      recentActivity: activityByClass.get(r.id) ?? [],
    };
  });
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [campus, setCampus] = useState<Campus>(mockCampus);
  const [classrooms, setClassrooms] = useState<Classroom[]>(mockClassrooms);
  const [alerts, setAlerts] = useState<Alert[]>(mockAlerts);
  const [notifications, setNotifications] = useState<NotificationItem[]>(mockNotifications);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [timetable, setTimetable] = useState<TimetableConfig>(defaultTimetable);
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [energyData, setEnergyData] = useState(mockEnergyData);
  const [quickControls, setQuickControls] = useState<QuickControls>({
    allLights: false, allFans: false, allCurtains: false,
  });
  const [isReady, setIsReady] = useState(false);

  // ESP32 Integration State
  const [esp32Ip, setEsp32IpState] = useState<string>(
    process.env.EXPO_PUBLIC_DEFAULT_ESP32_IP || '192.168.1.101'
  );
  const [esp32Connected, setEsp32Connected] = useState<boolean>(false);
  const [esp32Telemetry, setEsp32Telemetry] = useState<ESP32Telemetry | null>(null);
  const [systemMode, setSystemModeState] = useState<'auto' | 'manual'>('manual');
  const isLanReachableRef = useRef<boolean>(false);
  const lastModeToggleRef = useRef<number>(0);
  const lastManualIpSetRef = useRef<number>(0);
  const lastUserToggleRef = useRef<Record<string, number>>({});
  const pendingUserToggleStateRef = useRef<Record<string, DeviceStatus>>({});
  const lastNoticeSyncRef = useRef<number>(0);
  const lastTimeSyncRef = useRef<number>(0);
  const noticesRef = useRef<NoticeItem[]>([]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(STORAGE_KEYS.THEME_MODE, mode).catch(console.error);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(STORAGE_KEYS.THEME_MODE, next).catch(console.error);
      return next;
    });
  }, []);

  const isDark = themeMode === 'dark';
  const colors = isDark ? DarkColors : LightColors;

  const setEsp32Ip = useCallback(async (ip: string) => {
    const trimmed = ip.trim();
    if (!trimmed) return;
    lastManualIpSetRef.current = Date.now();
    setEsp32IpState(trimmed);
    await AsyncStorage.setItem(STORAGE_KEYS.ESP32_IP, trimmed).catch(console.error);

    if (isSupabaseConfigured) {
      try {
        await supabase
          .from('controllers')
          .update({ ip_address: trimmed, status: 'online', last_seen: new Date().toISOString() })
          .eq('id', 'ctrl-esp32');
      } catch (err) {
        console.error('Failed to sync controller IP to Supabase', err);
      }
    }
  }, []);

  const loadFromSupabase = useCallback(async (): Promise<boolean> => {
    if (!isSupabaseConfigured) return false;
    const [campusRes, classroomRes, controllerRes, deviceRes, alertRes, notifRes, activityRes] = await Promise.all([
      supabase.from('campuses').select('*'),
      supabase.from('classrooms').select('*'),
      supabase.from('controllers').select('*'),
      supabase.from('devices').select('*'),
      supabase.from('alerts').select('*'),
      supabase.from('notifications').select('*'),
      supabase.from('activity').select('*'),
    ]);
    const responses = [campusRes, classroomRes, controllerRes, deviceRes, alertRes, notifRes, activityRes];
    for (const r of responses) {
      if (r.error) throw new Error(r.error.message);
    }
    setCampus(campusRes.data?.[0] ? mapCampus(campusRes.data[0] as CampusRow) : mockCampus);
    const validRooms = (classroomRes.data as ClassroomRow[]).filter(
      c => c.id === 'cls-a101' || c.id === 'cls-a102' || c.id === 'cls-corridor'
    );
    const controllers = controllerRes.data as ControllerRow[];
    const esp32Ctrl = controllers.find(c => c.id === 'ctrl-esp32');
    if (esp32Ctrl) {
      if (esp32Ctrl.ip_address && Date.now() - lastManualIpSetRef.current > 30000) {
        setEsp32IpState(esp32Ctrl.ip_address);
      }
      if (esp32Ctrl.status === 'online') setEsp32Connected(true);
    }

    const modeDev = (deviceRes.data as DeviceRow[]).find(d => d.id === 'dev-system-mode');
    if (modeDev && (modeDev.status === 'auto' || modeDev.status === 'manual')) {
      setSystemModeState(modeDev.status);
    }

    // Auto-seed missing display devices into Supabase if needed
    const missingDevs = devsA101.filter(d => 
      (d.id === 'dev-a101-notice-board' || d.id === 'dev-a101-smart-screen') &&
      !(deviceRes.data as DeviceRow[]).some(row => row.id === d.id)
    );
    if (missingDevs.length > 0) {
      for (const md of missingDevs) {
        void supabase.from('devices').upsert({
          id: md.id,
          classroom_id: 'cls-a101',
          controller_id: md.controllerId,
          name: md.name,
          category: md.category,
          status: md.status,
          relay_channel: md.relayChannel,
          room_area: md.roomArea,
          capabilities: md.capabilities,
          settings: deviceSettings(md),
          power_usage: md.powerUsage,
          energy_today: md.energyToday,
          last_updated: md.lastUpdated,
        });
      }
    }

    setClassrooms(buildClassrooms(
      validRooms,
      controllers,
      deviceRes.data as DeviceRow[],
      alertRes.data as AlertRow[],
      activityRes.data as ActivityRow[],
    ));
    setAlerts((alertRes.data as AlertRow[]).map(mapAlert));
    // Decouple notifications: Never include notice board announcements in the notifications feed
    const rawNotifs = (notifRes.data as NotificationRow[]) || [];
    setNotifications(rawNotifs.filter(r => !r.type?.startsWith('notice')).map(mapNotification));
    setQuickControls({ allLights: false, allFans: false, allCurtains: false });

    try {
      // 1. Primary: Load Campus Notice Board items from dedicated 'announcements' table
      const annRes = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });

      let announcementRows: AnnouncementRow[] = [];
      if (!annRes.error && Array.isArray(annRes.data)) {
        announcementRows = annRes.data as AnnouncementRow[];
      } else {
        // Fallback: If 'announcements' table hasn't been created yet in SQL editor, read legacy notices from notifications
        const legacyNoticeRows = rawNotifs.filter(r => r.type && r.type.startsWith('notice'));
        announcementRows = legacyNoticeRows.map(l => {
          let dur = '24h';
          if (l.type && l.type.includes(':')) dur = l.type.split(':')[1];
          return {
            id: l.id,
            classroom_id: l.classroom_id || 'all',
            classroom_name: l.classroom_name,
            title: l.title,
            message: l.message,
            duration: dur,
            is_active: true,
            created_at: l.created_at,
          };
        });
      }

      const now = Date.now();
      const expiredIds: string[] = [];
      const validNotices: NoticeItem[] = [];

      for (const a of announcementRows) {
        let duration: NoticeDuration = (a.duration as NoticeDuration) || '24h';
        let expiresAt: string | null = a.expires_at || null;
        const createdMs = new Date(a.created_at).getTime();
        if (!expiresAt) {
          if (duration === '1h') expiresAt = new Date(createdMs + 3600000).toISOString();
          else if (duration === '24h') expiresAt = new Date(createdMs + 86400000).toISOString();
        }

        if (expiresAt && new Date(expiresAt).getTime() <= now) {
          expiredIds.push(a.id);
        } else if (a.is_active !== false) {
          validNotices.push({
            id: a.id,
            classroomId: a.classroom_id || 'all',
            classroomName: a.classroom_id === 'all'
              ? 'All Classrooms (Broadcast)'
              : (validRooms.find(r => r.id === a.classroom_id)?.name || a.classroom_name || a.classroom_id || 'Classroom'),
            title: a.title,
            message: a.message,
            duration,
            createdAt: a.created_at || new Date().toISOString(),
            expiresAt,
            isActive: true,
          });
        }
      }

      setNotices(validNotices);

      // Clean up any expired notices from cloud
      if (expiredIds.length > 0 && isSupabaseConfigured) {
        void supabase.from('announcements').delete().in('id', expiredIds);
        void supabase.from('notifications').delete().in('id', expiredIds);
      }
    } catch (e) {
      console.warn('Could not load announcements from Supabase:', e);
    }

    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      let ok = false;
      try {
        const storedTheme = await AsyncStorage.getItem(STORAGE_KEYS.THEME_MODE);
        if (storedTheme === 'light' || storedTheme === 'dark') {
          setThemeModeState(storedTheme as ThemeMode);
        }
      } catch (e) {
        console.error('Failed to load theme preference:', e);
      }
      try {
        ok = await loadFromSupabase();
      } catch (error) {
        console.error('Failed to load data from Supabase, falling back to cache', error);
      }
      if (cancelled) return;
      if (!ok) {
        try {
          const storedClassrooms = await AsyncStorage.getItem(STORAGE_KEYS.CLASSROOMS);
          const storedAlerts = await AsyncStorage.getItem(STORAGE_KEYS.ALERTS);
          const storedNotifications = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
          const storedQuickControls = await AsyncStorage.getItem(STORAGE_KEYS.QUICK_CONTROLS);
          const storedEsp32Ip = await AsyncStorage.getItem(STORAGE_KEYS.ESP32_IP);
          const storedSystemMode = await AsyncStorage.getItem(STORAGE_KEYS.SYSTEM_MODE);
          const storedNotices = await AsyncStorage.getItem(STORAGE_KEYS.NOTICES);

          if (storedNotices) {
            try {
              const parsed = JSON.parse(storedNotices);
              const now = Date.now();
              setNotices(parsed.filter((n: NoticeItem) => !n.expiresAt || new Date(n.expiresAt).getTime() > now));
            } catch {}
          }

          const storedTimetable = await AsyncStorage.getItem(STORAGE_KEYS.TIMETABLE);
          if (storedTimetable) {
            try {
              setTimetable(JSON.parse(storedTimetable));
            } catch {}
          }

          if (storedClassrooms) {
            try {
              const parsed = JSON.parse(storedClassrooms);
              const valid = Array.isArray(parsed)
                ? parsed.filter((c: any) => c.id === 'cls-a101' || c.id === 'cls-a102' || c.id === 'cls-corridor')
                : [];
              if (valid.length === 3) {
                setClassrooms(valid);
              } else {
                setClassrooms(mockClassrooms);
                void AsyncStorage.setItem(STORAGE_KEYS.CLASSROOMS, JSON.stringify(mockClassrooms));
              }
            } catch {
              setClassrooms(mockClassrooms);
            }
          }
          if (storedAlerts) setAlerts(JSON.parse(storedAlerts));
          if (storedNotifications) setNotifications(JSON.parse(storedNotifications));
          if (storedQuickControls) setQuickControls(JSON.parse(storedQuickControls));
          if (storedEsp32Ip) setEsp32IpState(storedEsp32Ip);
          if (storedSystemMode === 'auto' || storedSystemMode === 'manual') setSystemModeState(storedSystemMode);
        } catch (error) {
          console.error('Failed to load data from storage', error);
        }
      }
      setIsReady(true);
    };
    init();
    return () => { cancelled = true; };
  }, [loadFromSupabase]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.CLASSROOMS, JSON.stringify(classrooms)).catch(console.error);
  }, [classrooms, isReady]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alerts)).catch(console.error);
  }, [alerts, isReady]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifications)).catch(console.error);
  }, [notifications, isReady]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.QUICK_CONTROLS, JSON.stringify(quickControls)).catch(console.error);
  }, [quickControls, isReady]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.SYSTEM_MODE, systemMode).catch(console.error);
  }, [systemMode, isReady]);

  useEffect(() => {
    noticesRef.current = notices;
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.NOTICES, JSON.stringify(notices)).catch(console.error);
  }, [notices, isReady]);

  // Listen for Live Updates from Supabase (Devices, Sensor Telemetry & Controller Heartbeats)!
  useEffect(() => {
    if (!isReady || !isSupabaseConfigured) return;

    const channel = supabase.channel('realtime-smart-classroom')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'devices' },
        (payload) => {
          const newRecord = payload.new;
          if (newRecord && newRecord.id) {
            if (newRecord.id === 'dev-system-mode') {
              if (Date.now() - lastModeToggleRef.current > 10000) {
                if (newRecord.status === 'auto' || newRecord.status === 'manual') {
                  setSystemModeState(newRecord.status);
                }
              }
              return;
            }

            // Shield recent local toggles from stale echoes
            const timeSinceToggle = Date.now() - (lastUserToggleRef.current[newRecord.id] || 0);
            if (timeSinceToggle < 3500) {
              const expectedStatus = pendingUserToggleStateRef.current[newRecord.id];
              if (expectedStatus && newRecord.status !== expectedStatus) {
                // Echo has stale status, ignore!
                return;
              } else {
                delete lastUserToggleRef.current[newRecord.id];
                delete pendingUserToggleStateRef.current[newRecord.id];
              }
            }

            setClassrooms(prev => prev.map(cls => {
              if (cls.id !== newRecord.classroom_id) return cls;
              const updatedDevices = cls.devices.map(dev => {
                if (dev.id !== newRecord.id) return dev;
                const newSettings = (newRecord.settings as Record<string, unknown>) || {};
                const rated = typeof newSettings.ratedPower === 'number'
                  ? newSettings.ratedPower
                  : (dev.ratedPower || (newRecord.power_usage > 0 ? newRecord.power_usage : (dev.category === 'fan' ? 75 : dev.category === 'light' ? 60 : 40)));
                const isOn = newRecord.status === 'on';
                return {
                  ...dev,
                  status: newRecord.status as DeviceStatus,
                  ratedPower: rated,
                  powerUsage: isOn ? rated : 0,
                  capabilities: newRecord.capabilities ?? dev.capabilities,
                  lastUpdated: newRecord.last_updated ?? new Date().toISOString()
                };
              });

              const hasPhysicalSensor = cls.hasPowerMeter && cls.voltage && cls.voltage >= 60 && cls.current && cls.current >= 0.09;
              const newLoad = hasPhysicalSensor
                ? cls.currentLoad
                : updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);

              return {
                ...cls,
                currentLoad: newLoad,
                devices: updatedDevices,
              };
            }));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'classrooms' },
        (payload) => {
          const newRecord = payload.new;
          if (newRecord && newRecord.id) {
            setClassrooms(prev => prev.map(cls => {
              if (cls.id !== newRecord.id) return cls;
              const hasPhysicalSensor = cls.hasPowerMeter && cls.voltage && cls.voltage >= 60 && cls.current && cls.current >= 0.09;
              const activeDeviceLoad = cls.devices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);
              return {
                ...cls,
                occupancy: (newRecord.occupancy_status as 'occupied' | 'vacant') || cls.occupancy,
                temperature: typeof newRecord.temperature === 'number' ? newRecord.temperature : cls.temperature,
                currentLoad: hasPhysicalSensor
                  ? (typeof newRecord.current_load === 'number' ? newRecord.current_load : cls.currentLoad)
                  : activeDeviceLoad,
                status: (newRecord.status as 'online' | 'offline') || cls.status,
              };
            }));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'controllers' },
        (payload) => {
          const newRecord = payload.new;
          if (newRecord && newRecord.id === 'ctrl-esp32') {
            if (newRecord.status === 'online') setEsp32Connected(true);
            if (newRecord.ip_address && Date.now() - lastManualIpSetRef.current > 30000) {
              setEsp32IpState(newRecord.ip_address);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        async () => {
          try {
            const { data } = await supabase
              .from('notifications')
              .select('*')
              .order('created_at', { ascending: false });
            if (data) {
              // Never include notice announcements in notifications feed
              setNotifications(data.filter((r: any) => !r.type?.startsWith('notice')).map(mapNotification));
            }
          } catch (e) {
            console.error('Failed to update notifications from Realtime:', e);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        async () => {
          try {
            const { data } = await supabase
              .from('announcements')
              .select('*')
              .order('created_at', { ascending: false });
            if (data) {
              const now = Date.now();
              const validList: NoticeItem[] = [];
              for (const a of data as AnnouncementRow[]) {
                let duration: NoticeDuration = (a.duration as NoticeDuration) || '24h';
                let expiresAt: string | null = a.expires_at || null;
                const createdMs = new Date(a.created_at).getTime();
                if (!expiresAt) {
                  if (duration === '1h') expiresAt = new Date(createdMs + 3600000).toISOString();
                  else if (duration === '24h') expiresAt = new Date(createdMs + 86400000).toISOString();
                }

                if (expiresAt && new Date(expiresAt).getTime() <= now) {
                  // expired
                } else if (a.is_active !== false) {
                  validList.push({
                    id: a.id,
                    classroomId: a.classroom_id || 'all',
                    classroomName: a.classroom_name || (a.classroom_id === 'all' ? 'All Classrooms (Broadcast)' : a.classroom_id),
                    title: a.title,
                    message: a.message,
                    duration,
                    createdAt: a.created_at || new Date().toISOString(),
                    expiresAt,
                    isActive: true,
                  });
                }
              }
              setNotices(validList);
            }
          } catch (e) {
            console.error('Failed to update announcements from Realtime:', e);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isReady]);

  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ id: Date.now().toString(), message, type });
  }, []);

  const hideToast = useCallback(() => {
    setToast(null);
  }, []);

  const syncDevices = useCallback(async (updates: { id: string; data: Record<string, unknown> }[]) => {
    if (!isSupabaseConfigured) return;
    const now = new Date().toISOString();
    for (const u of updates) {
      const { error } = await supabase.from('devices').update({ ...u.data, last_updated: now }).eq('id', u.id);
      if (error) console.error('DEVICE SYNC FAILED', u.id, error.message);
    }
  }, []);

  // Synchronize Live Telemetry from physical ESP32
  const syncWithEsp32 = useCallback(async (): Promise<boolean> => {
    if (!esp32Ip || esp32Ip.trim() === '') return false;
    const baseUrl = esp32Ip.startsWith('http') ? esp32Ip.trim() : `http://${esp32Ip.trim()}`;
    const controller = new AbortController();
    const timeoutMs = isLanReachableRef.current ? 3500 : 2500;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/status`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      isLanReachableRef.current = true;
      setEsp32Connected(true);

      // Opportunistically synchronize phone real-time clock to ESP32 notice board at most once every 10 minutes
      const nowMs = Date.now();
      if (nowMs - lastTimeSyncRef.current > 600000) {
        lastTimeSyncRef.current = nowMs;
        const phoneEpochSec = Math.floor(nowMs / 1000);
        fetch(`${baseUrl}/api/time?epoch=${phoneEpochSec}`).catch(() => {});
      }
      const telemetry: ESP32Telemetry = {
        ip: data.controller?.ip || esp32Ip,
        ssid: data.controller?.ssid,
        mode: (data.mode === 'auto' || data.mode === 'manual') ? data.mode : systemMode,
        temperature: Number(data.temperature) || 24,
        humidity: Number(data.humidity) || 50,
        totalLoadWatts: Number(data.total_load_watts) || 0,
        rssi: data.controller?.rssi,
        uptimeSec: data.controller?.uptime_sec,
        firmware: data.controller?.firmware || '2.4.1',
        hourlyEnergy: Array.isArray(data.hourly_energy) ? data.hourly_energy.map(Number) : undefined,
        c1: {
          occupied: Boolean(data.classroom1?.occupied),
          light: Boolean(data.classroom1?.light),
          fan: Boolean(data.classroom1?.fan),
          curtain: Boolean(data.classroom1?.curtain),
          curtainAngle: Number(data.classroom1?.curtain_angle) || 0,
          smartScreen: data.classroom1?.smart_screen !== undefined ? Boolean(data.classroom1.smart_screen) : undefined,
          noticeBoard: data.classroom1?.notice_board !== undefined ? Boolean(data.classroom1.notice_board) : undefined,
          loadWatts: Number(data.classroom1?.load_watts) || 0,
          voltage: data.classroom1?.voltage !== undefined ? Number(data.classroom1.voltage) : 0,
          current: data.classroom1?.current !== undefined ? Number(data.classroom1.current) : 0,
          hasPowerMeter: true,
          energyToday: data.classroom1?.energy_today !== undefined ? Number(data.classroom1.energy_today) : undefined,
          estimatedCost: data.classroom1?.estimated_cost !== undefined ? Number(data.classroom1.estimated_cost) : undefined,
        },
        c2: {
          occupied: Boolean(data.classroom2?.occupied),
          light: Boolean(data.classroom2?.light),
          fan: Boolean(data.classroom2?.fan),
          curtain: Boolean(data.classroom2?.curtain),
          curtainAngle: Number(data.classroom2?.curtain_angle) || 0,
          loadWatts: Number(data.classroom2?.load_watts) || 0,
          voltage: 0,
          current: 0,
          hasPowerMeter: false,
          energyToday: data.classroom2?.energy_today !== undefined ? Number(data.classroom2.energy_today) : undefined,
          estimatedCost: data.classroom2?.estimated_cost !== undefined ? Number(data.classroom2.estimated_cost) : undefined,
        },
        corridors: {
          ldr1Raw: Number(data.corridors?.ldr1_raw) || 0,
          ldr2Raw: Number(data.corridors?.ldr2_raw) || 0,
          light1: Boolean(data.corridors?.light1),
          light2: Boolean(data.corridors?.light2),
        },
      };
      setEsp32Telemetry(telemetry);
      if (Date.now() - lastModeToggleRef.current > 10000) {
        if (telemetry.mode === 'auto' || telemetry.mode === 'manual') {
          setSystemModeState(telemetry.mode);
        }
      }

      // Update Live Consumption Chart from ESP32 Real-Time Hourly Readings
      if (Array.isArray(telemetry.hourlyEnergy) && telemetry.hourlyEnergy.length === 24) {
        setEnergyData(prev => ({
          ...prev,
          hourly: telemetry.hourlyEnergy!.map((val, i) => ({
            time: `${i.toString().padStart(2, '0')}:00`,
            value: Math.max(0, Number(val.toFixed(3))),
          })),
        }));
      }

      // Ensure ESP32 notice board is fully synchronized with app active notices
      const currentNotices = noticesRef.current;
      const espNoticeCount = Number(data.notice_count);
      const shouldSyncNotices = (
        currentNotices.length > 0 &&
        ((!isNaN(espNoticeCount) && espNoticeCount !== currentNotices.length) ||
         Date.now() - lastNoticeSyncRef.current > 60000)
      );

      if (shouldSyncNotices) {
        lastNoticeSyncRef.current = Date.now();
        fetch(`${baseUrl}/api/notices/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentNotices.map(n => ({
            id: n.id,
            classroom_id: n.classroomId,
            title: n.title,
            message: n.message,
            duration: n.duration,
          }))),
        }).catch(() => {});
      }

      // Helper to resolve device status while protecting recent user toggles from in-flight telemetry
      const resolveDeviceStatus = (dev: Device, hardwareIsOn: boolean): { status: DeviceStatus; powerUsage: number; ratedPower: number } => {
        const rated = dev.ratedPower || (dev.category === 'fan' ? 75 : dev.category === 'light' ? 60 : 40);
        const hwStatus: DeviceStatus = hardwareIsOn ? 'on' : 'off';
        const timeSinceToggle = Date.now() - (lastUserToggleRef.current[dev.id] || 0);

        if (timeSinceToggle < 3500) {
          const expected = pendingUserToggleStateRef.current[dev.id];
          if (expected && hwStatus !== expected) {
            // Retain optimistic user intent while hardware or poll catches up
            return {
              status: dev.status,
              ratedPower: rated,
              powerUsage: dev.status === 'on' ? rated : 0,
            };
          } else {
            delete lastUserToggleRef.current[dev.id];
            delete pendingUserToggleStateRef.current[dev.id];
          }
        }

        return {
          status: hwStatus,
          ratedPower: rated,
          powerUsage: hardwareIsOn ? rated : 0,
        };
      };

      // Reflect hardware states into Classroom models
      setClassrooms(prev => prev.map(cls => {
        // Classroom A101 (Classroom 1) - Connected to ACS712 & ZMPT101B
        if (cls.id === 'cls-a101' || cls.id.includes('101')) {
          const liveKwh = telemetry.c1.energyToday !== undefined ? telemetry.c1.energyToday : cls.energyToday;
          const liveCost = telemetry.c1.estimatedCost !== undefined ? telemetry.c1.estimatedCost : (liveKwh * 8.0);
          const updatedDevices = cls.devices.map(dev => {
            if (dev.category === 'light') {
              const res = resolveDeviceStatus(dev, telemetry.c1.light);
              return { ...dev, ...res };
            }
            if (dev.category === 'fan') {
              const res = resolveDeviceStatus(dev, telemetry.c1.fan);
              return { ...dev, ...res };
            }
            if (dev.category === 'curtain') {
              const cRated = dev.ratedPower || 5;
              const res = resolveDeviceStatus({ ...dev, ratedPower: cRated }, telemetry.c1.curtain);
              return { ...dev, ...res };
            }
            if ((dev.id.includes('notice') || dev.name.toLowerCase().includes('notice')) && telemetry.c1.noticeBoard !== undefined) {
              const res = resolveDeviceStatus(dev, telemetry.c1.noticeBoard);
              return { ...dev, ...res };
            }
            if ((dev.id.includes('screen') || dev.name.toLowerCase().includes('screen')) && telemetry.c1.smartScreen !== undefined) {
              const res = resolveDeviceStatus(dev, telemetry.c1.smartScreen);
              return { ...dev, ...res };
            }
            return dev;
          });

          // Use real physical measurement IF AC line is connected and active; otherwise sum active rated devices
          const hasRealAC = (telemetry.c1.voltage ?? 0) >= 60.0 && (telemetry.c1.current ?? 0) >= 0.09 && (telemetry.c1.loadWatts ?? 0) > 0.5;
          const activeDeviceWatts = updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);
          const c1Load = hasRealAC ? telemetry.c1.loadWatts : activeDeviceWatts;

          return {
            ...cls,
            temperature: telemetry.temperature,
            occupancy: telemetry.c1.occupied ? 'occupied' : 'vacant',
            currentLoad: c1Load,
            voltage: telemetry.c1.voltage ?? 0,
            current: telemetry.c1.current ?? 0,
            energyToday: liveKwh,
            estimatedCost: liveCost,
            hasPowerMeter: true,
            status: 'online',
            controller: {
              ...cls.controller,
              status: 'online',
              ipAddress: esp32Ip,
              signalStrength: (telemetry.rssi && telemetry.rssi > -60) ? 'strong' : (telemetry.rssi && telemetry.rssi > -75) ? 'medium' : 'weak',
              lastSeen: new Date().toISOString(),
            },
            devices: updatedDevices,
          };
        }

        // Classroom A102 (Classroom 2) - Standard setup (No Power Meter)
        if (cls.id === 'cls-a102' || cls.id.includes('102')) {
          const liveKwh = telemetry.c2.energyToday !== undefined ? telemetry.c2.energyToday : cls.energyToday;
          const liveCost = telemetry.c2.estimatedCost !== undefined ? telemetry.c2.estimatedCost : (liveKwh * 8.0);
          const updatedDevices = cls.devices.map(dev => {
            if (dev.category === 'light') {
              const res = resolveDeviceStatus(dev, telemetry.c2.light);
              return { ...dev, ...res };
            }
            if (dev.category === 'fan') {
              const res = resolveDeviceStatus(dev, telemetry.c2.fan);
              return { ...dev, ...res };
            }
            if (dev.category === 'curtain') {
              const cRated = dev.ratedPower || 5;
              const res = resolveDeviceStatus({ ...dev, ratedPower: cRated }, telemetry.c2.curtain);
              return { ...dev, ...res };
            }
            return dev;
          });

          // Dynamic rated power sum based on user specifications
          const c2Load = updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);

          return {
            ...cls,
            temperature: telemetry.temperature,
            occupancy: telemetry.c2.occupied ? 'occupied' : 'vacant',
            currentLoad: c2Load,
            voltage: 0,
            current: 0,
            energyToday: liveKwh,
            estimatedCost: liveCost,
            hasPowerMeter: false,
            status: 'online',
            controller: {
              ...cls.controller,
              status: 'online',
              ipAddress: esp32Ip,
              signalStrength: (telemetry.rssi && telemetry.rssi > -60) ? 'strong' : (telemetry.rssi && telemetry.rssi > -75) ? 'medium' : 'weak',
              lastSeen: new Date().toISOString(),
            },
            devices: updatedDevices,
          };
        }

        // Corridors & Hallways (Corridor Zone) - Standard setup (No Power Meter)
        if (cls.id === 'cls-corridor' || cls.id.includes('corr')) {
          const updatedDevices = cls.devices.map(dev => {
            const isDev1 = dev.id.includes('1');
            const hwOn = isDev1 ? telemetry.corridors.light1 : telemetry.corridors.light2;
            const res = resolveDeviceStatus(dev, hwOn);
            return { ...dev, ...res };
          });
          const corLoad = updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);
          return {
            ...cls,
            currentLoad: corLoad,
            voltage: 0,
            current: 0,
            hasPowerMeter: false,
            status: 'online',
            devices: updatedDevices,
          };
        }

        return cls;
      }));

      return true;
    } catch {
      isLanReachableRef.current = false;
      // Direct LAN fetch failed (phone is on cellular data or remote network).
      setEsp32Telemetry(null);

      // Synchronize state via Supabase Cloud!
      if (isSupabaseConfigured) {
        try {
          const [ctrlRes, devRes, clsRes] = await Promise.all([
            supabase.from('controllers').select('status, ip_address').eq('id', 'ctrl-esp32').single(),
            supabase.from('devices').select('id, classroom_id, status, power_usage, settings, energy_today, last_updated'),
            supabase.from('classrooms').select('id, temperature, occupancy_status, current_load, status'),
          ]);

          if (ctrlRes.data && ctrlRes.data.status === 'online') {
            setEsp32Connected(true);
            if (
              ctrlRes.data.ip_address &&
              Date.now() - lastManualIpSetRef.current > 30000 &&
              ctrlRes.data.ip_address !== esp32Ip
            ) {
              setEsp32IpState(ctrlRes.data.ip_address);
            }
          }

          if (devRes.data && devRes.data.length > 0) {
            if (Date.now() - lastModeToggleRef.current > 10000) {
              const modeDev = devRes.data.find(d => d.id === 'dev-system-mode');
              if (modeDev && (modeDev.status === 'auto' || modeDev.status === 'manual')) {
                setSystemModeState(modeDev.status);
              }
            }
            const devMap = new Map(devRes.data.map(d => [d.id, d]));
            setClassrooms(prev => prev.map(cls => {
              const updatedDevices = cls.devices.map(dev => {
                const cloudDev = devMap.get(dev.id);
                if (!cloudDev) return dev;
                // Protect recent optimistic toggle from being overwritten by in-flight cloud sync
                const timeSinceToggle = Date.now() - (lastUserToggleRef.current[dev.id] || 0);
                if (timeSinceToggle < 3500) {
                  const expected = pendingUserToggleStateRef.current[dev.id];
                  if (expected && cloudDev.status !== expected) {
                    return dev;
                  } else {
                    delete lastUserToggleRef.current[dev.id];
                    delete pendingUserToggleStateRef.current[dev.id];
                  }
                }
                const cloudSettings = (cloudDev.settings as Record<string, unknown>) || {};
                const rated = typeof cloudSettings.ratedPower === 'number'
                  ? cloudSettings.ratedPower
                  : (dev.ratedPower || (cloudDev.power_usage > 0 ? cloudDev.power_usage : (dev.category === 'fan' ? 75 : dev.category === 'light' ? 60 : 40)));
                const isOn = cloudDev.status === 'on';
                return {
                  ...dev,
                  status: cloudDev.status as DeviceStatus,
                  ratedPower: rated,
                  powerUsage: isOn ? rated : 0,
                  energyToday: typeof cloudDev.energy_today === 'number' ? cloudDev.energy_today : dev.energyToday,
                  lastUpdated: cloudDev.last_updated || dev.lastUpdated,
                };
              });

              const hasPhysicalSensor = cls.hasPowerMeter && cls.voltage && cls.voltage >= 60 && cls.current && cls.current >= 0.09;
              const computedLoad = updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);

              return {
                ...cls,
                currentLoad: hasPhysicalSensor ? cls.currentLoad : computedLoad,
                devices: updatedDevices,
              };
            }));
          }

          if (clsRes.data && clsRes.data.length > 0) {
            const clsMap = new Map(clsRes.data.map(c => [c.id, c]));
            setClassrooms(prev => prev.map(cls => {
              const cloudCls = clsMap.get(cls.id);
              if (!cloudCls) return cls;
              const hasPhysicalSensor = cls.hasPowerMeter && cls.voltage && cls.voltage >= 60 && cls.current && cls.current >= 0.09;
              const activeDeviceLoad = cls.devices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);
              return {
                ...cls,
                occupancy: (cloudCls.occupancy_status as 'occupied' | 'vacant') || cls.occupancy,
                temperature: typeof cloudCls.temperature === 'number' ? cloudCls.temperature : cls.temperature,
                currentLoad: hasPhysicalSensor
                  ? (typeof cloudCls.current_load === 'number' ? cloudCls.current_load : cls.currentLoad)
                  : activeDeviceLoad,
                status: (cloudCls.status as 'online' | 'offline') || cls.status,
              };
            }));
          }

          return true;
        } catch {
          // Supabase unreachable
        }
      }
      setEsp32Connected(false);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }, [esp32Ip]);

  const setSystemMode = useCallback(async (mode: 'auto' | 'manual') => {
    lastModeToggleRef.current = Date.now();
    setSystemModeState(mode);
    await AsyncStorage.setItem(STORAGE_KEYS.SYSTEM_MODE, mode).catch(console.error);

    // 1. FAST LAN PATH (Instantly notify all reachable controller IPs over local Wi-Fi)
    const candidateIps = new Set<string>();
    if (esp32Ip && esp32Ip.trim()) candidateIps.add(esp32Ip.trim());
    for (const cls of classrooms) {
      if (cls.controller?.ipAddress && cls.controller.ipAddress.trim()) {
        candidateIps.add(cls.controller.ipAddress.trim());
      }
    }

    candidateIps.forEach(ip => {
      const cleanIp = ip.trim();
      const baseUrl = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;
      const lanController = new AbortController();
      const lanTimeout = setTimeout(() => lanController.abort(), 1500);
      fetch(`${baseUrl}/mode?auto=${mode === 'auto' ? 1 : 0}`, { signal: lanController.signal })
        .then(() => clearTimeout(lanTimeout))
        .catch(() => clearTimeout(lanTimeout));
    });

    // 2. SUPABASE CLOUD PATH (Works on 4G/5G mobile data + syncs all remote apps)
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.from('devices')
          .update({ status: mode, last_updated: new Date().toISOString() })
          .eq('id', 'dev-system-mode');
        if (error) console.error('SYSTEM MODE SYNC FAILED:', error.message);
      } catch (e) {
        console.error('SYSTEM MODE EXCEPTION:', e);
      }
    }

    showToast(`Switched to ${mode.toUpperCase()} Mode`, 'info');
  }, [classrooms, esp32Ip, showToast]);

  const toggleEsp32Mode = useCallback(async () => {
    const nextMode = systemMode === 'auto' ? 'manual' : 'auto';
    await setSystemMode(nextMode);
  }, [systemMode, setSystemMode]);

  const toggleDevice = useCallback((classroomId: string, deviceId: string) => {
    const targetClass = classrooms.find(c => c.id === classroomId);
    const targetDev = targetClass?.devices.find(d => d.id === deviceId);
    if (!targetDev || targetDev.status === 'offline') return;

    const nextState = targetDev.status !== 'on';
    const newStatus: DeviceStatus = nextState ? 'on' : 'off';
    const rated = targetDev.ratedPower || (targetDev.category === 'fan' ? 75 : targetDev.category === 'light' ? 60 : 40);
    const powerUsage = nextState ? rated : 0;
    const deviceName = targetDev.name;
    let newClsLoad = 0;

    // Record optimistic state lock to protect UI switch from telemetry overwrites
    lastUserToggleRef.current[deviceId] = Date.now();
    pendingUserToggleStateRef.current[deviceId] = newStatus;

    // 1. FAST LAN PATH: Dispatch command directly to ESP32 hardware immediately (<5ms)
    const devCode = mapDeviceToEsp32Code(classroomId, targetDev);
    const candidateIps = new Set<string>();
    if (esp32Ip && esp32Ip.trim()) candidateIps.add(esp32Ip.trim());
    if (targetClass?.controller?.ipAddress && targetClass.controller.ipAddress.trim()) {
      candidateIps.add(targetClass.controller.ipAddress.trim());
    }
    for (const cls of classrooms) {
      if (cls.controller?.ipAddress && cls.controller.ipAddress.trim()) {
        candidateIps.add(cls.controller.ipAddress.trim());
      }
    }

    candidateIps.forEach(ip => {
      void sendEsp32Command(ip, devCode, nextState);
    });

    // 2. Optimistic local React state update (Instant 0ms UI response)
    setClassrooms(prev => prev.map(cls => {
      if (cls.id !== classroomId) return cls;
      const updatedDevices = cls.devices.map(dev => {
        if (dev.id !== deviceId) return dev;
        return {
          ...dev,
          status: newStatus,
          ratedPower: rated,
          powerUsage,
          lastUpdated: new Date().toISOString(),
        };
      });

      const hasPhysicalSensor = cls.hasPowerMeter && cls.voltage && cls.voltage >= 60 && cls.current && cls.current >= 0.09;
      newClsLoad = hasPhysicalSensor 
        ? cls.currentLoad 
        : updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);

      return {
        ...cls,
        currentLoad: newClsLoad,
        devices: updatedDevices,
      };
    }));

    // 3. Asynchronous cloud persistence in background - preserve ratedPower in settings!
    const existingSettings = deviceSettings(targetDev);
    existingSettings.ratedPower = rated;
    void syncDevices([{ 
      id: deviceId, 
      data: { 
        status: newStatus, 
        power_usage: powerUsage,
        settings: existingSettings,
      } 
    }]);

    void supabase.from('classrooms').update({ current_load: newClsLoad }).eq('id', classroomId);

    // 4. Manual override disarms Auto Mode so sensors don't fight user commands
    if (systemMode === 'auto') {
      void setSystemMode('manual');
      showToast('Manual Override: Switched to MANUAL Mode', 'info');
    } else if (deviceName) {
      showToast(`${deviceName} is ${newStatus.toUpperCase()}`, 'success');
    }
  }, [classrooms, esp32Ip, setSystemMode, showToast, syncDevices, systemMode]);

  const updateDeviceValue = useCallback((classroomId: string, deviceId: string, updates: Partial<Device>) => {
    let settings: Record<string, unknown> | null = null;
    setClassrooms(prev => prev.map(cls => {
      if (cls.id !== classroomId) return cls;
      return {
        ...cls,
        devices: cls.devices.map(dev => {
          if (dev.id !== deviceId) return dev;
          const updated = { ...dev, ...updates, lastUpdated: new Date().toISOString() };
          settings = deviceSettings(updated);
          return updated;
        }),
      };
    }));
    if (settings) void syncDevices([{ id: deviceId, data: { settings } }]);
  }, [syncDevices]);

  const updateDeviceRatedPower = useCallback(async (classroomId: string, deviceId: string, ratedWatts: number) => {
    let updatedLoad = 0;
    let targetDeviceCategory = '';
    let targetSettings: Record<string, unknown> = {};

    setClassrooms(prev => prev.map(cls => {
      if (cls.id !== classroomId) return cls;
      const updatedDevices = cls.devices.map(dev => {
        if (dev.id !== deviceId) return dev;
        targetDeviceCategory = dev.category;
        targetSettings = { ...deviceSettings(dev), ratedPower: ratedWatts };
        const isOn = dev.status === 'on';
        return {
          ...dev,
          ratedPower: ratedWatts,
          powerUsage: isOn ? ratedWatts : 0,
          settings: targetSettings,
          lastUpdated: new Date().toISOString(),
        };
      });

      const hasPhysicalSensor = cls.hasPowerMeter && cls.voltage && cls.voltage >= 60 && cls.current && cls.current >= 0.09;
      updatedLoad = hasPhysicalSensor 
        ? cls.currentLoad 
        : updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);

      return {
        ...cls,
        currentLoad: updatedLoad,
        devices: updatedDevices,
      };
    }));

    // Persist to Supabase devices table (store both power_usage and settings.ratedPower)
    const { error: devErr } = await supabase
      .from('devices')
      .update({ 
        power_usage: ratedWatts, 
        settings: targetSettings,
        last_updated: new Date().toISOString() 
      })
      .eq('id', deviceId);
    if (devErr) console.error('Failed to persist rated power to Supabase:', devErr.message);

    // Persist updated classroom current_load to Supabase classrooms table
    const { error: clsErr } = await supabase
      .from('classrooms')
      .update({ current_load: updatedLoad })
      .eq('id', classroomId);
    if (clsErr) console.error('Failed to persist classroom current_load to Supabase:', clsErr.message);

    // Also notify ESP32 if online so internal firmware load matches user customization
    if (esp32Ip) {
      try {
        let paramName = '';
        if (classroomId.includes('101')) {
          if (targetDeviceCategory === 'light') paramName = 'c1_light_w';
          else if (targetDeviceCategory === 'fan') paramName = 'c1_fan_w';
        } else if (classroomId.includes('102')) {
          if (targetDeviceCategory === 'light') paramName = 'c2_light_w';
          else if (targetDeviceCategory === 'fan') paramName = 'c2_fan_w';
        } else if (classroomId.includes('corr')) {
          if (deviceId.includes('1')) paramName = 'corr1_w';
          else paramName = 'corr2_w';
        }
        if (paramName) {
          fetch(`http://${esp32Ip}/api/config?${paramName}=${ratedWatts}`, { method: 'GET' }).catch(() => {});
        }
      } catch {}
    }

    showToast(`Rated load updated to ${ratedWatts}W`, 'success');
  }, [esp32Ip, showToast]);

  const toggleQuickControl = useCallback((control: keyof QuickControls) => {
    setQuickControls(prev => {
      const newState = !prev[control];
      const category = categoryMap[control];
      const sync: { id: string; data: Record<string, unknown> }[] = [];
      setClassrooms(prevCls => prevCls.map(cls => {
        const updatedDevices = cls.devices.map(dev => {
          if (dev.category !== category || dev.status === 'offline') return dev;
          const newStatus: DeviceStatus = newState ? 'on' : 'off';
          const rated = dev.ratedPower || (dev.category === 'fan' ? 75 : dev.category === 'light' ? 60 : 40);
          const powerUsage = newStatus === 'off' ? 0 : rated;
          const existingSettings = deviceSettings(dev);
          existingSettings.ratedPower = rated;
          sync.push({ id: dev.id, data: { status: newStatus, power_usage: powerUsage, settings: existingSettings } });
          lastUserToggleRef.current[dev.id] = Date.now();
          pendingUserToggleStateRef.current[dev.id] = newStatus;
          return { ...dev, status: newStatus, ratedPower: rated, powerUsage, lastUpdated: new Date().toISOString() };
        });

        const hasPhysicalSensor = cls.hasPowerMeter && cls.voltage && cls.voltage >= 60 && cls.current && cls.current >= 0.09;
        const newLoad = hasPhysicalSensor 
          ? cls.currentLoad 
          : updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);

        return {
          ...cls,
          currentLoad: newLoad,
          devices: updatedDevices,
        };
      }));
      if (sync.length) void syncDevices(sync);

      // Fast LAN dispatch to all candidate controller IPs
      const candidateIps = new Set<string>();
      if (esp32Ip && esp32Ip.trim()) candidateIps.add(esp32Ip.trim());
      for (const c of classrooms) {
        if (c.controller?.ipAddress && c.controller.ipAddress.trim()) {
          candidateIps.add(c.controller.ipAddress.trim());
        }
      }

      candidateIps.forEach(ip => {
        if (control === 'allLights') {
          void sendEsp32Command(ip, 'l1', newState);
          void sendEsp32Command(ip, 'l2', newState);
          void sendEsp32Command(ip, 'cr1', newState);
          void sendEsp32Command(ip, 'cr2', newState);
        } else if (control === 'allFans') {
          void sendEsp32Command(ip, 'f1', newState);
          void sendEsp32Command(ip, 'f2', newState);
        } else if (control === 'allCurtains') {
          void sendEsp32Command(ip, 'c1', newState);
          void sendEsp32Command(ip, 'c2', newState);
        }
      });

      if (systemMode === 'auto') {
        void setSystemMode('manual');
        showToast('Manual Override: Switched to MANUAL Mode', 'info');
      }

      return { ...prev, [control]: newState };
    });
  }, [classrooms, esp32Ip, setSystemMode, showToast, syncDevices, systemMode]);

  const emergencyOff = useCallback(() => {
    const sync: { id: string; data: Record<string, unknown> }[] = [];
    setClassrooms(prev => prev.map(cls => ({
      ...cls,
      currentLoad: 0,
      devices: cls.devices.map(dev => {
        if (dev.status === 'offline') return dev;
        const existingSettings = deviceSettings(dev);
        existingSettings.ratedPower = dev.ratedPower;
        sync.push({ id: dev.id, data: { status: 'off' as const, power_usage: 0, settings: existingSettings } });
        lastUserToggleRef.current[dev.id] = Date.now();
        pendingUserToggleStateRef.current[dev.id] = 'off';
        return {
          ...dev,
          status: 'off' as const,
          powerUsage: 0,
          lastUpdated: new Date().toISOString(),
        };
      }),
    })));
    setQuickControls({ allLights: false, allFans: false, allCurtains: false });
    if (sync.length) void syncDevices(sync);

    // Also update Supabase classrooms current_load to 0
    void supabase.from('classrooms').update({ current_load: 0 }).neq('id', '');

    // Hardware sync: Trigger emergency all-off on all candidate ESP32 controllers
    const candidateIps = new Set<string>();
    if (esp32Ip && esp32Ip.trim()) candidateIps.add(esp32Ip.trim());
    for (const c of classrooms) {
      if (c.controller?.ipAddress && c.controller.ipAddress.trim()) {
        candidateIps.add(c.controller.ipAddress.trim());
      }
    }

    candidateIps.forEach(ip => {
      void sendEsp32Command(ip, 'all', false);
    });

    if (systemMode === 'auto') {
      void setSystemMode('manual');
    }
  }, [classrooms, esp32Ip, setSystemMode, syncDevices, systemMode]);

  // Periodic Polling of ESP32 (every 3 seconds)
  useEffect(() => {
    if (!isReady || !esp32Ip) return;
    void syncWithEsp32();
    const interval = setInterval(() => {
      void syncWithEsp32();
    }, 3000);
    return () => clearInterval(interval);
  }, [isReady, esp32Ip, syncWithEsp32]);

  const addClassroom = useCallback((classroom: Classroom) => {
    setClassrooms(prev => [...prev, classroom]);
    if (isSupabaseConfigured) {
      void (async () => {
        const { error: cErr } = await supabase.from('classrooms').insert({
          id: classroom.id, name: classroom.name, room_number: classroom.number,
          department: classroom.department, building: classroom.building, floor: classroom.floor,
          capacity: classroom.capacity, occupancy_status: classroom.occupancy, status: classroom.status,
          temperature: classroom.temperature, current_load: classroom.currentLoad,
          energy_today: classroom.energyToday, estimated_cost: classroom.estimatedCost,
        });
        if (cErr) console.error('CLASSROOM INSERT FAILED', cErr.message);

        const c = classroom.controller;
        const { error: ctErr } = await supabase.from('controllers').upsert({
          id: c.id, classroom_id: classroom.id, name: c.name, type: c.type, status: c.status,
          signal_strength: c.signalStrength, ip_address: c.ipAddress || null,
          firmware_version: c.firmwareVersion || null, relay_channels: c.relayChannels,
          used_channels: c.usedChannels, last_seen: c.lastSeen,
        }, { onConflict: 'id' });
        if (ctErr) console.error('CONTROLLER INSERT FAILED', ctErr.message);

        for (const dev of classroom.devices) {
          const { error: dErr } = await supabase.from('devices').insert({
            id: dev.id, classroom_id: classroom.id, controller_id: dev.controllerId, name: dev.name,
            category: dev.category, status: dev.status, relay_channel: dev.relayChannel,
            room_area: dev.roomArea, capabilities: dev.capabilities, settings: deviceSettings(dev),
            power_usage: dev.powerUsage, energy_today: dev.energyToday, last_updated: dev.lastUpdated,
          });
          if (dErr) console.error('DEVICE INSERT FAILED', dErr.message);
        }
      })();
    }
  }, []);

  const addDevice = useCallback((classroomId: string, device: Device) => {
    setClassrooms(prev => prev.map(cls => {
      if (cls.id !== classroomId) return cls;
      return { ...cls, devices: [...cls.devices, device] };
    }));
    if (isSupabaseConfigured) {
      void (async () => {
        const { error } = await supabase.from('devices').insert({
          id: device.id, classroom_id: classroomId, controller_id: device.controllerId, name: device.name,
          category: device.category, status: device.status, relay_channel: device.relayChannel,
          room_area: device.roomArea, capabilities: device.capabilities, settings: deviceSettings(device),
          power_usage: device.powerUsage, energy_today: device.energyToday, last_updated: device.lastUpdated,
        });
        if (error) console.error('DEVICE INSERT FAILED', error.message);
      })();
    }
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    if (isSupabaseConfigured) {
      void supabase.from('notifications').update({ is_read: true }).eq('id', id).then(({ error }) => {
        if (error) console.error('NOTIFICATION UPDATE FAILED', error.message);
      });
    }
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    if (isSupabaseConfigured) {
      void supabase.from('notifications').update({ is_read: true }).eq('is_read', false).then(({ error }) => {
        if (error) console.error('NOTIFICATIONS UPDATE FAILED', error.message);
      });
    }
  }, []);

  const addNotice = useCallback(async (
    item: Omit<NoticeItem, 'id' | 'createdAt' | 'isActive'>
  ): Promise<boolean> => {
    const now = Date.now();
    let expiresAt: string | null = null;
    if (item.duration === '1h') {
      expiresAt = new Date(now + 3600000).toISOString();
    } else if (item.duration === '24h') {
      expiresAt = new Date(now + 86400000).toISOString();
    } else {
      expiresAt = null; // 'never'
    }

    const newNotice: NoticeItem = {
      id: `annc-${now}`,
      classroomId: item.classroomId,
      classroomName: item.classroomName,
      title: item.title.trim(),
      message: item.message.trim(),
      duration: item.duration,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      isActive: true,
    };

    // Optimistic local state update (ONLY in notices, NEVER in notifications)
    setNotices(prev => [newNotice, ...prev]);
    showToast(
      item.classroomId === 'all'
        ? 'Broadcast announcement published to all classrooms!'
        : 'Announcement posted to classroom Notice Board!',
      'success'
    );

    // 1. Direct LAN dispatch to ESP32 for immediate OLED update
    const targetIp = esp32Ip || classrooms.find(c => c.controller?.ipAddress)?.controller?.ipAddress;
    if (targetIp) {
      try {
        const baseUrl = targetIp.startsWith('http') ? targetIp : `http://${targetIp}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        fetch(`${baseUrl}/api/notice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newNotice.id,
            classroom_id: newNotice.classroomId,
            title: newNotice.title,
            message: newNotice.message,
            duration: newNotice.duration,
          }),
          signal: controller.signal,
        }).then(() => clearTimeout(timeoutId)).catch(() => clearTimeout(timeoutId));
      } catch {}
    }

    // 2. Cloud persistence in dedicated Supabase 'announcements' table
    if (isSupabaseConfigured) {
      try {
        const { error: annError } = await supabase.from('announcements').insert([{
          id: newNotice.id,
          classroom_id: newNotice.classroomId || 'all',
          classroom_name: newNotice.classroomName,
          title: newNotice.title,
          message: newNotice.message,
          duration: newNotice.duration || '24h',
          expires_at: expiresAt,
          is_active: true,
          created_at: newNotice.createdAt,
        }]);

        if (annError) {
          console.warn('[SUPABASE] Could not insert into announcements table:', annError.message);
          // Fallback if announcements table hasn't been created yet in SQL editor
          if (annError.message.includes('announcements')) {
            const dbClassroomId = (!newNotice.classroomId || newNotice.classroomId === 'all')
              ? null
              : newNotice.classroomId;

            await supabase.from('notifications').insert([{
              id: newNotice.id,
              type: `notice:${newNotice.duration || '24h'}`,
              title: newNotice.title,
              message: newNotice.message,
              classroom_id: dbClassroomId,
              classroom_name: newNotice.classroomName,
              is_read: false,
              created_at: newNotice.createdAt,
            }]);
          }
        } else {
          console.log('[SUPABASE] Announcement successfully saved to announcements table:', newNotice.id);
        }
      } catch (err) {
        console.error('Failed to sync announcement to Supabase:', err);
      }
    }

    // 3. Local AsyncStorage persistence
    AsyncStorage.setItem(STORAGE_KEYS.NOTICES, JSON.stringify([newNotice, ...notices])).catch(() => {});

    return true;
  }, [classrooms, esp32Ip, showToast]);

  const deleteNotice = useCallback(async (id: string): Promise<boolean> => {
    let remainingNotices: NoticeItem[] = [];
    setNotices(prev => {
      remainingNotices = prev.filter(n => n.id !== id);
      return remainingNotices;
    });
    // Decoupled: Deleting a Notice Board announcement NEVER deletes app notifications
    showToast('Announcement removed from board', 'info');

    // Update local cache
    AsyncStorage.getItem(STORAGE_KEYS.NOTICES).then(stored => {
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const updated = parsed.filter((n: NoticeItem) => n.id !== id);
          AsyncStorage.setItem(STORAGE_KEYS.NOTICES, JSON.stringify(updated)).catch(() => {});
        } catch {}
      }
    }).catch(() => {});

    // 1. Delete from Supabase announcements table
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.from('announcements').delete().eq('id', id);
        if (error) {
          console.warn('[SUPABASE] Delete from announcements:', error.message);
        }
        // Also cleanup legacy record in notifications if one existed
        void supabase.from('notifications').delete().eq('id', id);
      } catch (err) {
        console.error('Failed to delete announcement from Supabase:', err);
      }
    }

    // 2. Direct LAN dispatch to candidate ESP32 IPs
    const candidateIps = new Set<string>();
    if (esp32Ip && esp32Ip.trim()) candidateIps.add(esp32Ip.trim());
    for (const c of classrooms) {
      if (c.controller?.ipAddress && c.controller.ipAddress.trim()) {
        candidateIps.add(c.controller.ipAddress.trim());
      }
    }

    candidateIps.forEach(ip => {
      const cleanIp = ip.trim();
      const baseUrl = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      fetch(`${baseUrl}/api/notice/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
        signal: controller.signal,
      }).then(() => clearTimeout(timeoutId)).catch(() => clearTimeout(timeoutId));

      fetch(`${baseUrl}/api/notices/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(remainingNotices.map(n => ({
          id: n.id,
          classroom_id: n.classroomId,
          title: n.title,
          message: n.message,
          duration: n.duration,
        }))),
      }).catch(() => {});
    });

    return true;
  }, [classrooms, esp32Ip, showToast]);

  const deleteNotification = useCallback((id: string) => {
    // Decoupled: Deleting an app notification NEVER touches or removes Campus Notice Board items!
    setNotifications(prev => prev.filter(n => n.id !== id));

    if (isSupabaseConfigured) {
      void supabase.from('notifications').delete().eq('id', id).then(({ error }) => {
        if (error) console.error('NOTIFICATION DELETE FAILED', error.message);
      });
    }
  }, []);

  const clearAllNotifications = useCallback(() => {
    // Decoupled: Clearing all notifications clears ONLY system notifications, leaving Notice Board intact!
    setNotifications([]);

    if (isSupabaseConfigured) {
      void supabase.from('notifications').delete().not('type', 'like', 'notice%').then(({ error }) => {
        if (error) console.error('CLEAR ALL NOTIFICATIONS FAILED', error.message);
      });
    }
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a));
    if (isSupabaseConfigured) {
      void supabase.from('alerts').update({ is_read: true }).eq('id', id).then(({ error }) => {
        if (error) console.error('ALERT UPDATE FAILED', error.message);
      });
    }
  }, []);

  const updateEsp32WiFi = useCallback(async (ssid: string, password: string): Promise<{ success: boolean; message: string }> => {
    const trimmedSsid = ssid.trim();
    if (!trimmedSsid) {
      return { success: false, message: 'SSID cannot be empty' };
    }

    if (esp32Ip) {
      try {
        const baseUrl = esp32Ip.startsWith('http') ? esp32Ip : `http://${esp32Ip}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`${baseUrl}/api/wifi`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ssid: trimmedSsid, password }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          showToast(`Wi-Fi saved! Controller rebooting into "${trimmedSsid}"`, 'success');
          return { success: true, message: `Wi-Fi saved! Controller is rebooting into "${trimmedSsid}".` };
        }
      } catch (err) {
        console.warn('LAN Wi-Fi update failed:', err);
      }
    }

    return {
      success: false,
      message: 'Could not reach ESP32 directly. Ensure your phone is connected to the same Wi-Fi or the "NBA-Smart-Classroom" setup hotspot.',
    };
  }, [esp32Ip, showToast]);

  const updateTimetable = useCallback(async (newConfig: TimetableConfig) => {
    setTimetable(newConfig);
    await AsyncStorage.setItem(STORAGE_KEYS.TIMETABLE, JSON.stringify(newConfig)).catch(console.error);

    // Send timetable to ESP32 for autonomous clock triggers
    const candidateIps = new Set<string>();
    if (esp32Ip && esp32Ip.trim()) candidateIps.add(esp32Ip.trim());
    for (const c of classrooms) {
      if (c.controller?.ipAddress && c.controller.ipAddress.trim()) {
        candidateIps.add(c.controller.ipAddress.trim());
      }
    }

    candidateIps.forEach(ip => {
      const cleanIp = ip.trim();
      const baseUrl = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      fetch(`${baseUrl}/api/timetable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
        signal: controller.signal,
      }).then(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
    });

    showToast('Class Timetable & Bell Schedule Saved', 'success');
  }, [classrooms, esp32Ip, showToast]);

  const triggerBellTest = useCallback(async (pattern: BellPattern = 'college-bell') => {
    const candidateIps = new Set<string>();
    if (esp32Ip && esp32Ip.trim()) candidateIps.add(esp32Ip.trim());
    for (const c of classrooms) {
      if (c.controller?.ipAddress && c.controller.ipAddress.trim()) {
        candidateIps.add(c.controller.ipAddress.trim());
      }
    }

    if (candidateIps.size === 0) {
      return { success: false, message: 'ESP32 Controller offline or IP not configured' };
    }

    let success = false;
    for (const ip of candidateIps) {
      try {
        const cleanIp = ip.trim();
        const baseUrl = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${baseUrl}/api/bell?pattern=${encodeURIComponent(pattern)}`, {
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          success = true;
          break;
        }
      } catch {}
    }

    if (success) {
      showToast(`Period Bell (${pattern}) Chimed!`, 'success');
      return { success: true, message: 'Bell chimed successfully' };
    }
    return { success: false, message: 'Could not reach ESP32 to test bell' };
  }, [classrooms, esp32Ip, showToast]);


  if (!isReady) return null;

  return (
    <AppContext.Provider value={{
      user: mockUser, campus, classrooms, alerts, notifications,
      energyData, quickControls, toast,
      showToast, hideToast,
      toggleDevice, toggleQuickControl, emergencyOff,
      addClassroom, addDevice,
      markNotificationRead, markAllNotificationsRead, deleteNotification, clearAllNotifications,
      dismissAlert, updateDeviceValue, updateDeviceRatedPower,
      esp32Ip, setEsp32Ip, esp32Connected, esp32Telemetry,
      systemMode, setSystemMode,
      syncWithEsp32, toggleEsp32Mode,
      updateEsp32WiFi,
      notices, addNotice, deleteNotice,
      timetable, updateTimetable, triggerBellTest,
      themeMode, setThemeMode, toggleTheme, isDark, colors,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}

export function useTheme() {
  const { colors, isDark, themeMode, setThemeMode, toggleTheme } = useApp();
  return { colors, isDark, themeMode, setThemeMode, toggleTheme };
}