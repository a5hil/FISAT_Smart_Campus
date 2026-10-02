import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vibration } from 'react-native';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { playChimeWebAudio } from '../lib/audioChimes';
import {
  User, Campus, Classroom, Device, Controller, Alert, NotificationItem, ActivityItem, EnergyReading,
  DeviceCategory, DeviceStatus, DeviceCapability, ClassroomStatus, OccupancyStatus, AlertSeverity, NotificationType,
  ESP32Telemetry, NoticeItem, NoticeDuration, TimetableConfig, TimetablePeriod, BellPattern, DeviceSchedule,
} from '../types';
import {
  mockUser, mockCampus, mockClassrooms, mockAlerts, mockNotifications, mockEnergyData, devsA101, devsCorridor, defaultTimetable,
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
  isAuthenticated: boolean;
  loginUser: (identifier: string, pass: string) => Promise<{ success: boolean; message: string; user?: User }>;
  logoutUser: () => Promise<void>;
  registerUser: (name: string, username: string, email: string, pass: string, role?: string, department?: string) => Promise<{ success: boolean; message: string }>;
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
  updateDeviceSchedule: (classroomId: string, deviceId: string, schedule: DeviceSchedule) => void;
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
  LOGGED_IN_USER: '@logged_in_user',
};

const SETTING_KEYS = ['brightness', 'speed', 'temperature', 'mode', 'fanSpeed', 'volume', 'source', 'direction', 'colorTemp', 'color', 'rgbMode', 'schedule'] as const;

function deviceSettings(dev: Device): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  const record = dev as unknown as Record<string, unknown>;
  for (const k of SETTING_KEYS) {
    if (record[k] !== undefined) s[k] = record[k];
  }
  // Guarantee rgbMode and mode are always in complete lockstep for RGB strips
  if (dev.id === 'dev-corr-rgb-strip' || dev.id.includes('rgb') || dev.id.includes('strip')) {
    const effectiveMode = (dev.rgbMode || dev.mode || 'solid') as string;
    s.rgbMode = effectiveMode;
    s.mode = effectiveMode;
  }
  return s;
}

// ─── ESP32 Hardware Integration Helpers ──────────────────────────────
function mapDeviceToEsp32Code(classroomId: string, device: Device): string {
  if (device.id === 'dev-corr-rgb-strip' || device.id.includes('rgb') || device.id.includes('strip')) {
    return 'rgb';
  }
  if (device.id === 'dev-a101-notice-board' || device.id.includes('notice') || device.name?.toLowerCase().includes('notice')) {
    return 'nb';
  }
  if (device.id === 'dev-a101-smart-screen' || device.id.includes('screen') || device.id.includes('smart') || device.name?.toLowerCase().includes('screen')) {
    return 'ss';
  }
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
    if (device.category === 'light') return 'l1';
    if (device.category === 'fan') return 'f1';
    if (device.category === 'curtain') return 'c1';
  }
  return isC2 ? 'l2' : 'l1';
}

async function sendEsp32Command(ip: string, dev: string, st: boolean, timeoutMs = 3500, extraParams = '') {
  if (!ip || ip.trim() === '') return;
  const cleanIp = ip.trim();
  const baseUrl = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;
  const url = `${baseUrl}/ctrl?dev=${encodeURIComponent(dev)}&st=${st ? '1' : '0'}&force=1${extraParams}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.log(`[ESP32 Sync] Direct LAN command to ${cleanIp} (${dev}=${st}): HTTP ${res.status}`);
    }
  } catch (e: any) {
    if (e.name === 'AbortError' || e.message?.includes('canceled') || e.message?.includes('aborted')) {
      console.log(`[ESP32 Sync] Direct LAN command to ${cleanIp} (${dev}=${st}): timeout (${timeoutMs}ms) - controller offline or busy`);
    } else {
      console.log(`[ESP32 Sync] Direct LAN command to ${cleanIp} (${dev}=${st}):`, e.message);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Supabase row types ──────────────────────────────────────────────
interface CampusRow { id: string; name: string; department: string; buildings: string[] | null; }
interface ClassroomRow {
  id: string; name: string; room_number: string; department: string; building: string; floor: string;
  capacity: number; occupancy_status: string; status: string; temperature: number; humidity?: number; current_load: number;
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
  const rgbMode = (typeof settings.rgbMode === 'string' && settings.rgbMode)
    ? settings.rgbMode
    : ((typeof settings.mode === 'string' && settings.mode) ? settings.mode : undefined);
  return {
    id: row.id, name: row.name, category: row.category as DeviceCategory,
    status: row.status as DeviceStatus, controllerId: row.controller_id,
    relayChannel: row.relay_channel, roomArea: row.room_area,
    capabilities: (row.capabilities as DeviceCapability | null) ?? { power: true },
    powerUsage: row.status === 'on' ? rated : 0,
    ratedPower: rated,
    energyToday: row.energy_today, lastUpdated: row.last_updated,
    ...settings,
    ...(rgbMode ? { rgbMode, mode: rgbMode } : {}),
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

  // Ensure Corridor zone includes WS2812B LED strip
  const corrDevs = devicesByClass.get('cls-corridor') ?? [];
  const missingCorrDevs = devsCorridor.filter(
    d => d.id === 'dev-corr-rgb-strip' &&
         !corrDevs.some(existing => existing.id === d.id)
  );
  if (missingCorrDevs.length > 0) {
    devicesByClass.set('cls-corridor', [...corrDevs, ...missingCorrDevs]);
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
      temperature: r.temperature, humidity: typeof (r as any).humidity === 'number' ? (r as any).humidity : 55,
      currentLoad: initialLoad, energyToday: r.energy_today,
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
  const [currentUser, setCurrentUser] = useState<User>(mockUser);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [campus, setCampus] = useState<Campus>(mockCampus);
  const [classrooms, setClassrooms] = useState<Classroom[]>(mockClassrooms);
  const [alerts, setAlerts] = useState<Alert[]>(mockAlerts);
  const [notifications, setNotifications] = useState<NotificationItem[]>(mockNotifications);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [timetable, setTimetable] = useState<TimetableConfig>(defaultTimetable);
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [energyData, setEnergyData] = useState(mockEnergyData);
  const quickControls = useMemo<QuickControls>(() => {
    const allDevices = classrooms.flatMap(c => c.devices).filter(d => d.status !== 'offline');
    const lights = allDevices.filter(d => d.category === 'light');
    const fans = allDevices.filter(d => d.category === 'fan');
    const curtains = allDevices.filter(d => d.category === 'curtain');

    return {
      allLights: lights.length > 0 && lights.some(d => d.status === 'on'),
      allFans: fans.length > 0 && fans.some(d => d.status === 'on'),
      allCurtains: curtains.length > 0 && curtains.some(d => d.status === 'on'),
    };
  }, [classrooms]);
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
  const rgbFetchAbortRef = useRef<AbortController | null>(null);
  const debouncedSyncTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const realtimeControlChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastRgbChangeRef = useRef<number>(0);
  const pendingRgbModeRef = useRef<string | undefined>(undefined);
  const pendingRgbColorRef = useRef<string | undefined>(undefined);
  const pendingRgbBrightnessRef = useRef<number | undefined>(undefined);
  const lastBellTestTimeRef = useRef<number>(0);

  const broadcastDeviceCommand = useCallback((devCode: string, state: boolean, extra?: Record<string, unknown>) => {
    if (!realtimeControlChannelRef.current) return;
    try {
      void realtimeControlChannelRef.current.send({
        type: 'broadcast',
        event: 'cmd',
        payload: {
          dev: devCode,
          st: state ? 1 : 0,
          t: Date.now(),
          ...extra,
        },
      });
    } catch (e) {
      console.warn('[REALTIME] Broadcast error:', e);
    }
  }, []);

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

    // Cloud Timetable Sync: Load timetable saved in dev-system-mode settings
    if (modeDev && modeDev.settings && typeof modeDev.settings === 'object') {
      const cloudTt = (modeDev.settings as Record<string, unknown>).timetable as TimetableConfig | undefined;
      if (cloudTt && Array.isArray(cloudTt.periods) && cloudTt.periods.length > 0) {
        setTimetable(cloudTt);
        void AsyncStorage.setItem(STORAGE_KEYS.TIMETABLE, JSON.stringify(cloudTt));
      } else {
        // Seed default timetable into Supabase so cloud and ESP32 have a shared copy
        void supabase.from('devices').update({
          settings: {
            ...((modeDev.settings as Record<string, unknown>) || {}),
            timetable: defaultTimetable,
          },
          last_updated: new Date().toISOString(),
        }).eq('id', 'dev-system-mode');
      }
    }

    // Auto-seed missing display devices into Supabase if needed
    const missingDevs = [
      ...devsA101.filter(d => 
        (d.id === 'dev-a101-notice-board' || d.id === 'dev-a101-smart-screen') &&
        !(deviceRes.data as DeviceRow[]).some(row => row.id === d.id)
      ).map(d => ({ ...d, classroom_id: 'cls-a101' })),
      ...devsCorridor.filter(d => 
        d.id === 'dev-corr-rgb-strip' &&
        !(deviceRes.data as DeviceRow[]).some(row => row.id === d.id)
      ).map(d => ({ ...d, classroom_id: 'cls-corridor' })),
    ];
    if (missingDevs.length > 0) {
      for (const md of missingDevs) {
        void supabase.from('devices').upsert({
          id: md.id,
          classroom_id: md.classroom_id,
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
        const savedUserStr = await AsyncStorage.getItem(STORAGE_KEYS.LOGGED_IN_USER);
        if (savedUserStr) {
          const parsedUser = JSON.parse(savedUserStr);
          if (parsedUser && parsedUser.name) {
            setCurrentUser(parsedUser);
            setIsAuthenticated(true);
          }
        }
      } catch (e) {
        console.error('Failed to load user session:', e);
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
              // Real-time Timetable synchronization across devices
              if (newRecord.settings && typeof newRecord.settings === 'object') {
                const cloudTt = (newRecord.settings as Record<string, unknown>).timetable as TimetableConfig | undefined;
                if (cloudTt && Array.isArray(cloudTt.periods) && cloudTt.periods.length > 0) {
                  setTimetable(cloudTt);
                  void AsyncStorage.setItem(STORAGE_KEYS.TIMETABLE, JSON.stringify(cloudTt));
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

                // Shield recent RGB changes from stale Supabase echo
                const isRecentRgb = (dev.id === 'dev-corr-rgb-strip' || dev.id.includes('rgb')) && Date.now() - lastRgbChangeRef.current < 5000;
                const shieldSettings = isRecentRgb ? {
                  ...newSettings,
                  ...(pendingRgbModeRef.current ? { rgbMode: pendingRgbModeRef.current, mode: pendingRgbModeRef.current } : {}),
                  ...(pendingRgbColorRef.current ? { color: pendingRgbColorRef.current } : {}),
                  ...(pendingRgbBrightnessRef.current !== undefined ? { brightness: pendingRgbBrightnessRef.current } : {}),
                } : newSettings;

                return {
                  ...dev,
                  ...shieldSettings,
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
                humidity: typeof newRecord.humidity === 'number' ? newRecord.humidity : cls.humidity,
                energyToday: typeof newRecord.energy_today === 'number' ? newRecord.energy_today : cls.energyToday,
                estimatedCost: typeof newRecord.estimated_cost === 'number' ? newRecord.estimated_cost : cls.estimatedCost,
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

    // Subscribe to low-latency device control broadcast channel (Phoenix channels)
    const controlChannel = supabase.channel('device_control', {
      config: { broadcast: { ack: false, self: false } },
    });
    controlChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Send initial clock synchronization to ESP32 hardware RTC
        void controlChannel.send({
          type: 'broadcast',
          event: 'cmd',
          payload: {
            dev: 'time',
            st: 1,
            epoch: Math.floor(Date.now() / 1000),
            t: Date.now(),
          },
        });
      }
    });
    realtimeControlChannelRef.current = controlChannel;

    // Periodic time sync every 60s keeps ESP32 hardware RTC accurate even across mobile data
    const timeSyncInterval = setInterval(() => {
      if (realtimeControlChannelRef.current) {
        void realtimeControlChannelRef.current.send({
          type: 'broadcast',
          event: 'cmd',
          payload: {
            dev: 'time',
            st: 1,
            epoch: Math.floor(Date.now() / 1000),
            t: Date.now(),
          },
        });
      }
    }, 60000);

    return () => {
      clearInterval(timeSyncInterval);
      supabase.removeChannel(channel);
      if (controlChannel) supabase.removeChannel(controlChannel);
      realtimeControlChannelRef.current = null;
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
    if (!isSupabaseConfigured || updates.length === 0) return;
    const now = new Date().toISOString();
    try {
      await Promise.all(
        updates.map(u =>
          supabase.from('devices').update({ ...u.data, last_updated: now }).eq('id', u.id)
        )
      );
    } catch (err) {
      console.error('DEVICE SYNC FAILED:', err);
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
            humidity: telemetry.humidity,
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
            humidity: telemetry.humidity,
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
            if (dev.id === 'dev-corr-rgb-strip' || dev.id.includes('rgb') || dev.id.includes('strip')) {
              const rgbHwOn = telemetry.corridors.rgb !== undefined ? telemetry.corridors.rgb.power : (dev.status === 'on');
              const res = resolveDeviceStatus(dev, rgbHwOn);
              // Shield recent user RGB changes from stale incoming telemetry
              const isRecentRgbChange = Date.now() - lastRgbChangeRef.current < 5000;
              const effectiveColor = (isRecentRgbChange && pendingRgbColorRef.current) 
                ? pendingRgbColorRef.current 
                : (telemetry.corridors.rgb?.color || dev.color || '#FF6B00');
              const effectiveBrightness = (isRecentRgbChange && pendingRgbBrightnessRef.current !== undefined)
                ? pendingRgbBrightnessRef.current
                : (telemetry.corridors.rgb?.brightness !== undefined ? telemetry.corridors.rgb.brightness : (dev.brightness ?? 80));
              const effectiveRgbMode = (isRecentRgbChange && pendingRgbModeRef.current)
                ? pendingRgbModeRef.current
                : (telemetry.corridors.rgb?.mode || dev.rgbMode || 'solid');

              return {
                ...dev,
                ...res,
                color: effectiveColor,
                brightness: effectiveBrightness,
                rgbMode: effectiveRgbMode,
                mode: effectiveRgbMode,
              };
            }
            const isDev1 = dev.id.includes('1');
            const hwOn = isDev1 ? telemetry.corridors.light1 : telemetry.corridors.light2;
            const res = resolveDeviceStatus(dev, hwOn);
            return { ...dev, ...res };
          });
          const corLoad = updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);
          return {
            ...cls,
            temperature: telemetry.temperature,
            humidity: telemetry.humidity,
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
            supabase.from('classrooms').select('id, temperature, humidity, occupancy_status, current_load, energy_today, estimated_cost, status'),
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

                // Shield recent RGB changes from stale cloud fallback fetch
                const isRecentRgb = (dev.id === 'dev-corr-rgb-strip' || dev.id.includes('rgb')) && Date.now() - lastRgbChangeRef.current < 5000;
                const shieldSettings = isRecentRgb ? {
                  ...cloudSettings,
                  ...(pendingRgbModeRef.current ? { rgbMode: pendingRgbModeRef.current, mode: pendingRgbModeRef.current } : {}),
                  ...(pendingRgbColorRef.current ? { color: pendingRgbColorRef.current } : {}),
                  ...(pendingRgbBrightnessRef.current !== undefined ? { brightness: pendingRgbBrightnessRef.current } : {}),
                } : cloudSettings;

                return {
                  ...dev,
                  ...shieldSettings,
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
                humidity: typeof (cloudCls as any).humidity === 'number' ? (cloudCls as any).humidity : cls.humidity,
                energyToday: typeof cloudCls.energy_today === 'number' ? cloudCls.energy_today : cls.energyToday,
                estimatedCost: typeof cloudCls.estimated_cost === 'number' ? cloudCls.estimated_cost : cls.estimatedCost,
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

    // 3. Instant Realtime WebSocket broadcast (<50ms over mobile data)
    broadcastDeviceCommand('mode', mode === 'auto');

    showToast(`Switched to ${mode.toUpperCase()} Mode`, 'info');
  }, [broadcastDeviceCommand, classrooms, esp32Ip, showToast]);

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

    let extraParams = '';
    if (devCode === 'rgb') {
      const col = targetDev.color || '#FF6B00';
      const bri = targetDev.brightness ?? 80;
      const mod = targetDev.rgbMode || 'solid';
      extraParams = `&color=${encodeURIComponent(col)}&b=${bri}&mode=${encodeURIComponent(mod)}`;
    }

    candidateIps.forEach(ip => {
      void sendEsp32Command(ip, devCode, nextState, 3500, extraParams);
    });

    // Sub-50ms Realtime WebSocket Broadcast to ESP32 (instant over mobile data)
    broadcastDeviceCommand(
      devCode,
      nextState,
      devCode === 'rgb' ? {
        color: targetDev.color || '#FF6B00',
        b: targetDev.brightness ?? 80,
        mode: targetDev.rgbMode || 'solid',
      } : undefined
    );

    // 2. Optimistic local React state update (Instant 0ms UI response)
    const autoOffStartedAt = newStatus === 'on' && targetDev.schedule?.autoOffEnabled ? new Date().toISOString() : null;

    setClassrooms(prev => prev.map(cls => {
      if (cls.id !== classroomId) return cls;
      const updatedDevices = cls.devices.map(dev => {
        if (dev.id !== deviceId) return dev;
        const sched = dev.schedule;
        return {
          ...dev,
          status: newStatus,
          ratedPower: rated,
          powerUsage,
          lastUpdated: new Date().toISOString(),
          schedule: sched ? { ...sched, autoOffStartedAt } : undefined,
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

    // 3. Asynchronous cloud persistence in background - preserve ratedPower & schedule in settings!
    const existingSettings = deviceSettings(targetDev);
    existingSettings.ratedPower = rated;
    if (targetDev.schedule) {
      existingSettings.schedule = {
        ...targetDev.schedule,
        autoOffStartedAt,
      };
    }
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
    // 1. Synchronously resolve existing device and calculate new settings
    const targetCls = classrooms.find(c => c.id === classroomId) || classrooms.find(c => c.devices.some(d => d.id === deviceId));
    const targetDev = targetCls?.devices.find(d => d.id === deviceId);
    const effectiveClassroomId = targetCls?.id || classroomId;

    const mergedDev: Device | null = targetDev ? {
      ...targetDev,
      ...updates,
      lastUpdated: new Date().toISOString(),
    } : null;

    const targetSettings = mergedDev ? deviceSettings(mergedDev) : null;

    if (deviceId === 'dev-corr-rgb-strip' || deviceId.includes('rgb')) {
      lastRgbChangeRef.current = Date.now();
      if (updates.rgbMode) pendingRgbModeRef.current = updates.rgbMode;
      if (updates.color) pendingRgbColorRef.current = updates.color;
      if (updates.brightness !== undefined) pendingRgbBrightnessRef.current = updates.brightness;
    }

    // 2. Immediate optimistic state update in React
    setClassrooms(prev => prev.map(cls => {
      if (cls.id !== effectiveClassroomId) return cls;
      return {
        ...cls,
        devices: cls.devices.map(dev => {
          if (dev.id !== deviceId) return dev;
          return {
            ...dev,
            ...updates,
            ...(updates.rgbMode ? { rgbMode: updates.rgbMode, mode: updates.rgbMode } : {}),
            lastUpdated: new Date().toISOString(),
          };
        }),
      };
    }));

    // 3. Cloud database persistence: immediate for discrete modes/power, debounced for rapid color/brightness drags
    if (targetSettings) {
      const isDiscrete = updates.rgbMode !== undefined || updates.status !== undefined;
      const syncData: Record<string, unknown> = { settings: targetSettings };
      if (updates.status !== undefined) syncData.status = updates.status;
      if (updates.powerUsage !== undefined) syncData.power_usage = updates.powerUsage;

      if (isDiscrete) {
        if (debouncedSyncTimeoutRef.current[deviceId]) {
          clearTimeout(debouncedSyncTimeoutRef.current[deviceId]);
          delete debouncedSyncTimeoutRef.current[deviceId];
        }
        void syncDevices([{ id: deviceId, data: syncData }]);
      } else {
        if (debouncedSyncTimeoutRef.current[deviceId]) {
          clearTimeout(debouncedSyncTimeoutRef.current[deviceId]);
        }
        const syncCopy = Object.assign({}, syncData);
        debouncedSyncTimeoutRef.current[deviceId] = setTimeout(() => {
          void syncDevices([{ id: deviceId, data: syncCopy }]);
          delete debouncedSyncTimeoutRef.current[deviceId];
        }, 300);
      }
    }

    // 4. Instant LAN dispatch for WS2812B RGB Strip with active in-flight request abortion
    if (deviceId === 'dev-corr-rgb-strip' || deviceId.includes('rgb')) {
      if (rgbFetchAbortRef.current) {
        rgbFetchAbortRef.current.abort();
      }
      const controller = new AbortController();
      rgbFetchAbortRef.current = controller;

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
        let url = `${baseUrl}/ctrl?dev=rgb`;
        if (updates.status !== undefined) url += `&st=${updates.status === 'on' ? '1' : '0'}`;
        if (updates.color) url += `&color=${encodeURIComponent(updates.color)}`;
        if (updates.brightness !== undefined) url += `&b=${updates.brightness}`;
        const activeMode = updates.rgbMode || targetDev?.rgbMode;
        if (activeMode) url += `&mode=${encodeURIComponent(activeMode)}`;

        fetch(url, { signal: controller.signal }).catch(() => {});
      });
    }

    // 5. Sub-50ms Realtime WebSocket Broadcast to ESP32
    const devCodeForBc = targetDev ? mapDeviceToEsp32Code(effectiveClassroomId, targetDev) : (deviceId.includes('rgb') ? 'rgb' : '');
    if (devCodeForBc) {
      broadcastDeviceCommand(
        devCodeForBc,
        updates.status ? updates.status === 'on' : (targetDev?.status === 'on'),
        devCodeForBc === 'rgb' ? {
          color: updates.color ?? targetDev?.color,
          b: updates.brightness ?? targetDev?.brightness,
          mode: updates.rgbMode ?? targetDev?.rgbMode ?? 'solid',
        } : undefined
      );
    }
  }, [broadcastDeviceCommand, classrooms, esp32Ip, syncDevices]);

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

  const updateDeviceSchedule = useCallback((classroomId: string, deviceId: string, schedule: DeviceSchedule) => {
    const targetCls = classrooms.find(c => c.id === classroomId) || classrooms.find(c => c.devices.some(d => d.id === deviceId));
    const targetDev = targetCls?.devices.find(d => d.id === deviceId);
    const targetSettings = targetDev ? { ...deviceSettings(targetDev), schedule } : null;

    setClassrooms(prev => prev.map(cls => {
      if (cls.id !== classroomId) return cls;
      return {
        ...cls,
        devices: cls.devices.map(dev => {
          if (dev.id !== deviceId) return dev;
          return {
            ...dev,
            schedule,
            lastUpdated: new Date().toISOString(),
          };
        }),
      };
    }));

    if (targetSettings) {
      void syncDevices([{ id: deviceId, data: { settings: targetSettings } }]);
    }

    // Direct Instant Sync over local Wi-Fi to ESP32 onboard hardware flash memory
    if (esp32Ip && esp32Ip.trim() !== '') {
      const cleanIp = esp32Ip.trim();
      const baseUrl = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;

      // 1. Post schedule directly into ESP32 NVS flash memory
      fetch(`${baseUrl}/api/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deviceId, schedule }),
      }).catch(() => {});

      // 2. Sync phone's current epoch timestamp to ESP32 hardware RTC clock
      // Ensures accurate 24/7 onboard scheduling even without active internet/WAN!
      const currentEpoch = Math.floor(Date.now() / 1000);
      fetch(`${baseUrl}/api/time?epoch=${currentEpoch}`).catch(() => {});
    }

    // 3. Instant Realtime WebSocket broadcast (<50ms over mobile data / cellular)
    broadcastDeviceCommand('sched', schedule.enabled, { id: deviceId, schedule });

    showToast(schedule.enabled ? 'Schedule saved and activated' : 'Schedule disabled', 'success');
  }, [broadcastDeviceCommand, esp32Ip, showToast, syncDevices]);

  // ─── Automated Device Schedule & Countdown Timer Engine ─────────────
  const lastScheduleTriggerRef = useRef<Record<string, { on?: string; off?: string }>>({});

  useEffect(() => {
    const checkSchedules = () => {
      const now = new Date();
      const currentDay = now.getDay() === 0 ? 7 : now.getDay(); // 1=Mon .. 7=Sun
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${hh}:${mm}`;
      const todayDateStr = now.toISOString().slice(0, 10);

      setClassrooms(prevClassrooms => {
        let changed = false;

        const updatedClassrooms = prevClassrooms.map(cls => {
          let clsChanged = false;

          const updatedDevices = cls.devices.map(dev => {
            const sched = dev.schedule;
            if (!sched || !sched.enabled) return dev;

            const triggerKey = `${dev.id}-${todayDateStr}`;
            const lastTriggers = lastScheduleTriggerRef.current[triggerKey] || {};

            let newStatus = dev.status;
            let statusChanged = false;
            let autoOffStarted = sched.autoOffStartedAt;

            // 1. Check Daily Scheduled ON Time
            const dayActive = !sched.days || sched.days.length === 0 || sched.days.includes(currentDay);
            if (dayActive && sched.onTime && sched.onTime === currentTimeStr && lastTriggers.on !== currentTimeStr) {
              if (dev.status !== 'on') {
                newStatus = 'on';
                statusChanged = true;
                if (sched.autoOffEnabled && sched.autoOffMinutes) {
                  autoOffStarted = now.toISOString();
                }
                lastScheduleTriggerRef.current[triggerKey] = {
                  ...lastTriggers,
                  on: currentTimeStr,
                };
                showToast(`[Schedule] ${dev.name} powered ON`, 'info');
              }
            }

            // 2. Check Daily Scheduled OFF Time
            if (dayActive && sched.offTime && sched.offTime === currentTimeStr && lastTriggers.off !== currentTimeStr) {
              if (dev.status === 'on') {
                newStatus = 'off';
                statusChanged = true;
                autoOffStarted = null;
                lastScheduleTriggerRef.current[triggerKey] = {
                  ...lastTriggers,
                  off: currentTimeStr,
                };
                showToast(`[Schedule] ${dev.name} powered OFF`, 'info');
              }
            }

            // 3. Check Auto-off Countdown Timer
            if (sched.autoOffEnabled && sched.autoOffMinutes && dev.status === 'on' && autoOffStarted) {
              const elapsedMs = now.getTime() - new Date(autoOffStarted).getTime();
              const limitMs = sched.autoOffMinutes * 60 * 1000;
              if (elapsedMs >= limitMs) {
                newStatus = 'off';
                statusChanged = true;
                autoOffStarted = null;
                showToast(`[Timer] ${dev.name} automatically powered OFF (${sched.autoOffMinutes}m)`, 'info');
              }
            }

            if (statusChanged) {
              clsChanged = true;
              changed = true;
              const rated = dev.ratedPower || (dev.category === 'fan' ? 75 : dev.category === 'light' ? 60 : 40);
              const newUsage = newStatus === 'on' ? rated : 0;
              const updatedDev: Device = {
                ...dev,
                status: newStatus,
                powerUsage: newUsage,
                lastUpdated: now.toISOString(),
                schedule: {
                  ...sched,
                  autoOffStartedAt: autoOffStarted,
                },
              };

              // Dispatch to hardware & Supabase
              void (async () => {
                const espDev = mapDeviceToEsp32Code(cls.id, dev);
                // Sub-50ms Realtime WebSocket broadcast for mobile data & remote cellular actuation
                broadcastDeviceCommand(espDev, newStatus === 'on');

                if (esp32Ip && esp32Ip.trim()) {
                  try {
                    const ac = new AbortController();
                    const to = setTimeout(() => ac.abort(), 1200);
                    await fetch(`http://${esp32Ip}/ctrl?dev=${espDev}&st=${newStatus === 'on' ? 1 : 0}`, { signal: ac.signal });
                    clearTimeout(to);
                  } catch {}
                }
                const st = deviceSettings(updatedDev);
                void syncDevices([{
                  id: dev.id,
                  data: {
                    status: newStatus,
                    power_usage: newUsage,
                    settings: st,
                  },
                }]);
              })();

              return updatedDev;
            }

            return dev;
          });

          if (clsChanged) {
            const hasPhysicalSensor = cls.hasPowerMeter && cls.voltage && cls.voltage >= 60 && cls.current && cls.current >= 0.09;
            const newLoad = hasPhysicalSensor 
              ? cls.currentLoad 
              : updatedDevices.reduce((sum, d) => sum + (d.status === 'on' ? (d.powerUsage || 0) : 0), 0);
            return {
              ...cls,
              currentLoad: newLoad,
              devices: updatedDevices,
            };
          }

          return cls;
        });

        return changed ? updatedClassrooms : prevClassrooms;
      });
    };

    const interval = setInterval(checkSchedules, 15000);
    return () => clearInterval(interval);
  }, [esp32Ip, showToast, syncDevices]);

  const toggleQuickControl = useCallback((control: keyof QuickControls) => {
    const category = categoryMap[control];
    const targetDevices = classrooms
      .flatMap(c => c.devices)
      .filter(d => d.category === category && d.status !== 'offline');
    const isAnyOn = targetDevices.some(d => d.status === 'on');
    // If any are ON, master switch turns all OFF. If none are ON, turns all ON.
    const newState = !isAnyOn;
    const newStatus: DeviceStatus = newState ? 'on' : 'off';
    const nowMs = Date.now();

    const sync: { id: string; data: Record<string, unknown> }[] = [];
    setClassrooms(prevCls => prevCls.map(cls => {
      const updatedDevices = cls.devices.map(dev => {
        if (dev.category !== category || dev.status === 'offline') return dev;
        const rated = dev.ratedPower || (dev.category === 'fan' ? 75 : dev.category === 'light' ? 60 : 40);
        const powerUsage = newStatus === 'off' ? 0 : rated;
        const existingSettings = deviceSettings(dev);
        existingSettings.ratedPower = rated;
        sync.push({ id: dev.id, data: { status: newStatus, power_usage: powerUsage, settings: existingSettings } });
        lastUserToggleRef.current[dev.id] = nowMs;
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
        void sendEsp32Command(ip, 'rgb', newState);
      } else if (control === 'allFans') {
        void sendEsp32Command(ip, 'f1', newState);
        void sendEsp32Command(ip, 'f2', newState);
      } else if (control === 'allCurtains') {
        void sendEsp32Command(ip, 'c1', newState);
        void sendEsp32Command(ip, 'c2', newState);
      }
    });

    // Sub-50ms Realtime WebSocket broadcast for group controls
    if (control === 'allLights') {
      broadcastDeviceCommand('l1', newState);
      broadcastDeviceCommand('l2', newState);
      broadcastDeviceCommand('cr1', newState);
      broadcastDeviceCommand('cr2', newState);
      broadcastDeviceCommand('rgb', newState);
    } else if (control === 'allFans') {
      broadcastDeviceCommand('f1', newState);
      broadcastDeviceCommand('f2', newState);
    } else if (control === 'allCurtains') {
      broadcastDeviceCommand('c1', newState);
      broadcastDeviceCommand('c2', newState);
    }

    if (systemMode === 'auto') {
      void setSystemMode('manual');
      showToast('Manual Override: Switched to MANUAL Mode', 'info');
    }
  }, [broadcastDeviceCommand, classrooms, esp32Ip, setSystemMode, showToast, syncDevices, systemMode]);

  const emergencyOff = useCallback(() => {
    const sync: { id: string; data: Record<string, unknown> }[] = [];
    const nowMs = Date.now();
    setClassrooms(prev => prev.map(cls => ({
      ...cls,
      currentLoad: 0,
      devices: cls.devices.map(dev => {
        if (dev.status === 'offline') return dev;
        const existingSettings = deviceSettings(dev);
        existingSettings.ratedPower = dev.ratedPower;
        sync.push({ id: dev.id, data: { status: 'off' as const, power_usage: 0, settings: existingSettings } });
        lastUserToggleRef.current[dev.id] = nowMs;
        pendingUserToggleStateRef.current[dev.id] = 'off';
        return {
          ...dev,
          status: 'off' as const,
          powerUsage: 0,
          lastUpdated: new Date().toISOString(),
        };
      }),
    })));

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

    broadcastDeviceCommand('all', false);

    if (systemMode === 'auto') {
      void setSystemMode('manual');
    }
    showToast('Emergency All-Off Triggered', 'info');
  }, [broadcastDeviceCommand, classrooms, esp32Ip, setSystemMode, showToast, syncDevices, systemMode]);

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

    // 0. Sub-50ms Realtime WebSocket broadcast for instant display & buzzer chime over mobile data
    broadcastDeviceCommand('notice', true, {
      id: newNotice.id,
      classroom_id: newNotice.classroomId || 'all',
      title: newNotice.title,
      message: newNotice.message,
      duration: newNotice.duration || '24h',
    });

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
  }, [broadcastDeviceCommand, classrooms, esp32Ip, showToast]);

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

    // 0. Sub-50ms Realtime WebSocket broadcast for instant notice deletion over mobile data
    broadcastDeviceCommand('notice_del', false, { id });

    return true;
  }, [broadcastDeviceCommand, classrooms, esp32Ip, showToast]);

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

    // 1. CLOUD SYNC: Persist Timetable to Supabase dev-system-mode settings
    // This guarantees the schedule is shared across all devices and pulled by ESP32 globally!
    if (isSupabaseConfigured) {
      try {
        const { data: modeRow } = await supabase
          .from('devices')
          .select('settings')
          .eq('id', 'dev-system-mode')
          .single();
        const existingSettings = (modeRow?.settings as Record<string, unknown>) || {};
        const { error: ttErr } = await supabase
          .from('devices')
          .update({
            settings: {
              ...existingSettings,
              timetable: newConfig,
            },
            last_updated: new Date().toISOString(),
          })
          .eq('id', 'dev-system-mode');
        if (ttErr) {
          console.warn('[TIMETABLE] Supabase sync error:', ttErr.message);
        }
      } catch (err) {
        console.warn('[TIMETABLE] Cloud timetable save exception:', err);
      }
    }

    // 2. Direct LAN sync to ESP32 for immediate instant update if on local Wi-Fi
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

    // 3. Instant Realtime WebSocket broadcast (<50ms over mobile data / cellular)
    broadcastDeviceCommand('tt', true, { timetable: newConfig });

    showToast('Class Timetable & Bell Schedule Saved', 'success');
  }, [broadcastDeviceCommand, classrooms, esp32Ip, showToast]);

  const triggerBellTest = useCallback(async (pattern: BellPattern = 'college-bell') => {
    // 0. Debounce guard to prevent rapid double-clicks on UI buttons
    const now = Date.now();
    if (now - lastBellTestTimeRef.current < 2000) {
      return { success: true, message: 'Bell test already in progress' };
    }
    lastBellTestTimeRef.current = now;

    // 1. Haptic vibration feedback on the phone
    try {
      Vibration.vibrate([0, 150, 100, 150]);
    } catch {}

    // 2. Concurrently attempt direct local LAN trigger if candidate IPs exist
    const candidateIps = new Set<string>();
    if (esp32Ip && esp32Ip.trim()) candidateIps.add(esp32Ip.trim());
    for (const c of classrooms) {
      if (c.controller?.ipAddress && c.controller.ipAddress.trim()) {
        candidateIps.add(c.controller.ipAddress.trim());
      }
    }

    let lanSuccess = false;
    if (candidateIps.size > 0) {
      const lanPromises = Array.from(candidateIps).map(async (ip) => {
        try {
          const cleanIp = ip.trim();
          const baseUrl = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1200);
          const res = await fetch(`${baseUrl}/api/bell?pattern=${encodeURIComponent(pattern)}`, {
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) lanSuccess = true;
        } catch {}
      });
      await Promise.allSettled(lanPromises);
    }

    // If local LAN succeeded (same Wi-Fi), the bell has already chimed!
    // Skip cloud dispatch to prevent playing the chime twice!
    if (lanSuccess) {
      showToast(`Classroom Bell (${pattern}) Chimed (Local LAN)!`, 'success');
      return { success: true, message: 'Bell chimed via local network' };
    }

    // 3. If LAN failed or phone is on Mobile Data / Remote Network, dispatch via Supabase Cloud!
    // Shared trigger timestamp ensures ESP32 WebSocket and DB-poll match and suppress duplicates
    const triggerTs = String(now);
    broadcastDeviceCommand('bell', true, { pattern, ts: triggerTs });

    if (isSupabaseConfigured) {
      try {
        const { data: modeRow } = await supabase
          .from('devices')
          .select('settings')
          .eq('id', 'dev-system-mode')
          .single();
        const existingSettings = (modeRow?.settings as Record<string, unknown>) || {};
        const { error: bellErr } = await supabase
          .from('devices')
          .update({
            settings: {
              ...existingSettings,
              bell_trigger: {
                pattern,
                timestamp: now,
                ts: triggerTs,
              },
            },
            last_updated: new Date().toISOString(),
          })
          .eq('id', 'dev-system-mode');

        if (!bellErr) {
          showToast(`Classroom Bell (${pattern}) Chimed via Cloud!`, 'success');
          return { success: true, message: 'Bell chimed via cloud' };
        }
      } catch (e) {
        console.warn('[BELL] Cloud bell dispatch error:', e);
      }
    }

    // 4. Play local audio chime preview ONLY if ESP32 / Cloud is unreachable (offline fallback preview)
    const webAudioPlayed = playChimeWebAudio(pattern);
    if (webAudioPlayed) {
      showToast(`Period Bell (${pattern}) Preview Played (ESP32 Offline)`, 'info');
      return { success: true, message: 'Audio preview played' };
    }
    return { success: false, message: 'Could not reach ESP32 or Cloud to test bell' };
  }, [broadcastDeviceCommand, classrooms, esp32Ip, showToast]);

  const loginUser = useCallback(async (identifier: string, pass: string): Promise<{ success: boolean; message: string; user?: User }> => {
    const cleanId = identifier.trim();
    const cleanPass = pass.trim();

    if (!cleanId || !cleanPass) {
      return { success: false, message: 'Please enter both username/email and password.' };
    }

    try {
      if (isSupabaseConfigured) {
        let userRow: any = null;

        // Try RPC verification function first
        try {
          const { data: rpcData, error: rpcError } = await supabase.rpc('verify_user_login', {
            p_identifier: cleanId,
            p_password: cleanPass,
          });
          if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
            userRow = rpcData[0];
          }
        } catch (rpcErr) {
          console.log('[Auth] verify_user_login RPC fallback:', rpcErr);
        }

        // Direct table query fallback if RPC wasn't available or returned empty
        if (!userRow) {
          const { data: directRows, error: directErr } = await supabase
            .from('app_users')
            .select('*')
            .or(`username.ilike.${cleanId},email.ilike.${cleanId}`)
            .eq('password', cleanPass)
            .limit(1);

          if (!directErr && directRows && directRows.length > 0) {
            userRow = directRows[0];
          }
        }

        if (userRow) {
          const name = userRow.name || userRow.full_name || cleanId;
          const initials = name
            .split(' ')
            .filter(Boolean)
            .map((part: string) => part[0])
            .join('')
            .toUpperCase()
            .substring(0, 2) || 'U';

          const authenticatedUser: User = {
            id: userRow.id,
            name: name,
            username: userRow.username || cleanId,
            email: userRow.email || '',
            role: userRow.role || 'Department Administrator',
            department: userRow.department || 'IMCA Department',
            initials: initials,
          };

          setCurrentUser(authenticatedUser);
          setIsAuthenticated(true);
          await AsyncStorage.setItem(STORAGE_KEYS.LOGGED_IN_USER, JSON.stringify(authenticatedUser));
          showToast(`Welcome back, ${authenticatedUser.name}!`, 'success');
          return { success: true, message: 'Login successful', user: authenticatedUser };
        }
      }

      // Hardcoded fallback for default offline demo users if network is disconnected
      const cleanLower = cleanId.toLowerCase();
      if ((cleanLower === 'admin' || cleanLower === 'admin@fisat.ac.in') && cleanPass === 'admin123') {
        const adminUser: User = {
          name: 'Nershel Nelson',
          username: 'admin',
          initials: 'NN',
          role: 'Department Administrator',
          email: 'admin@fisat.ac.in',
          department: 'IMCA Department',
        };
        setCurrentUser(adminUser);
        setIsAuthenticated(true);
        await AsyncStorage.setItem(STORAGE_KEYS.LOGGED_IN_USER, JSON.stringify(adminUser));
        showToast('Welcome back, Nershel Nelson!', 'success');
        return { success: true, message: 'Login successful', user: adminUser };
      }

      return { success: false, message: 'Invalid username/email or password.' };
    } catch (err: any) {
      console.error('[Auth] Login error:', err);
      return { success: false, message: err?.message || 'Login failed due to network error.' };
    }
  }, [showToast]);

  const logoutUser = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.LOGGED_IN_USER);
      setIsAuthenticated(false);
      setCurrentUser(mockUser);
      showToast('Logged out successfully', 'info');
    } catch (e) {
      console.error('[Auth] Logout error:', e);
    }
  }, [showToast]);

  const registerUser = useCallback(async (
    name: string,
    username: string,
    email: string,
    pass: string,
    role = 'Department Administrator',
    department = 'IMCA Department'
  ): Promise<{ success: boolean; message: string }> => {
    if (!name.trim() || !username.trim() || !email.trim() || !pass.trim()) {
      return { success: false, message: 'Please fill in all required fields.' };
    }

    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.from('app_users').insert([
          {
            name: name.trim(),
            username: username.trim().toLowerCase(),
            email: email.trim().toLowerCase(),
            password: pass.trim(),
            role: role,
            department: department,
            is_active: true,
          }
        ]).select().single();

        if (error) {
          if (error.message.includes('unique') || error.code === '23505') {
            return { success: false, message: 'A user with this username or email already exists.' };
          }
          return { success: false, message: error.message };
        }

        if (data) {
          return { success: true, message: 'Account registered successfully! You can now sign in.' };
        }
      }
      return { success: false, message: 'Could not connect to database.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Registration failed.' };
    }
  }, []);

  if (!isReady) return null;

  return (
    <AppContext.Provider value={{
      user: currentUser, isAuthenticated, loginUser, logoutUser, registerUser,
      campus, classrooms, alerts, notifications,
      energyData, quickControls, toast,
      showToast, hideToast,
      toggleDevice, toggleQuickControl, emergencyOff,
      addClassroom, addDevice,
      markNotificationRead, markAllNotificationsRead, deleteNotification, clearAllNotifications,
      dismissAlert, updateDeviceValue, updateDeviceRatedPower, updateDeviceSchedule,
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