export type DeviceCategory =
  | 'light'
  | 'fan'
  | 'ac'
  | 'television'
  | 'projector'
  | 'smart-board'
  | 'display'
  | 'speaker'
  | 'computer'
  | 'cctv'
  | 'smart-lock'
  | 'curtain'
  | 'charging-outlet'
  | 'exhaust-fan'
  | 'other';

export type DeviceStatus = 'on' | 'off' | 'offline';
export type ClassroomStatus = 'online' | 'offline';
export type OccupancyStatus = 'occupied' | 'vacant';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type NotificationType =
  | 'device-offline'
  | 'high-consumption'
  | 'device-left-on'
  | 'classroom-vacant'
  | 'controller-reconnected'
  | 'maintenance-reminder';

export interface DeviceCapability {
  power: boolean;
  brightness?: boolean;
  speed?: boolean;
  temperature?: boolean;
  mode?: boolean;
  volume?: boolean;
  source?: boolean;
  direction?: boolean;
  timer?: boolean;
  colorTemp?: boolean;
  color?: boolean;
}

export interface Device {
  id: string;
  name: string;
  category: DeviceCategory;
  status: DeviceStatus;
  controllerId: string;
  relayChannel: number;
  roomArea: string;
  capabilities: DeviceCapability;
  brightness?: number;
  speed?: number;
  temperature?: number;
  mode?: string;
  fanSpeed?: string;
  volume?: number;
  source?: string;
  color?: string;
  rgbMode?: string;
  powerUsage: number;
  ratedPower?: number;
  energyToday: number;
  lastUpdated: string;
}

export interface Controller {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'offline';
  signalStrength: 'strong' | 'medium' | 'weak';
  relayChannels: number;
  usedChannels: number[];
  ipAddress: string;
  firmwareVersion: string;
  lastSeen: string;
}

export interface Classroom {
  id: string;
  name: string;
  number: string;
  department: string;
  building: string;
  floor: string;
  capacity: number;
  occupancy: OccupancyStatus;
  status: ClassroomStatus;
  temperature: number;
  humidity?: number;
  currentLoad: number;
  energyToday: number;
  estimatedCost: number;
  voltage?: number;
  current?: number;
  hasPowerMeter?: boolean;
  controller: Controller;
  devices: Device[];
  alerts: Alert[];
  recentActivity: ActivityItem[];
  description?: string;
}

export interface Alert {
  id: string;
  classroomId: string;
  classroomName: string;
  severity: AlertSeverity;
  message: string;
  time: string;
  isRead: boolean;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  classroomId?: string;
  classroomName?: string;
  time: string;
  isRead: boolean;
}

export interface ActivityItem {
  id: string;
  action: string;
  user: string;
  time: string;
  classroomId?: string;
}

export interface EnergyReading {
  time: string;
  value: number;
}

export interface User {
  id?: string;
  name: string;
  username?: string;
  initials: string;
  role: string;
  email: string;
  department?: string;
}

export interface Campus {
  name: string;
  department: string;
  buildings: string[];
}

export interface ESP32Telemetry {
  ip: string;
  ssid?: string;
  mode: 'auto' | 'manual';
  temperature: number;
  humidity: number;
  totalLoadWatts: number;
  rssi?: number;
  uptimeSec?: number;
  firmware?: string;
  hourlyEnergy?: number[];
  c1: {
    occupied: boolean;
    light: boolean;
    fan: boolean;
    curtain: boolean;
    curtainAngle: number;
    loadWatts: number;
    voltage?: number;
    current?: number;
    hasPowerMeter?: boolean;
    smartScreen?: boolean;
    noticeBoard?: boolean;
    energyToday?: number;
    estimatedCost?: number;
  };
  c2: {
    occupied: boolean;
    light: boolean;
    fan: boolean;
    curtain: boolean;
    curtainAngle: number;
    loadWatts: number;
    voltage?: number;
    current?: number;
    hasPowerMeter?: boolean;
    energyToday?: number;
    estimatedCost?: number;
  };
  corridors: {
    ldr1Raw: number;
    ldr2Raw: number;
    light1: boolean;
    light2: boolean;
    rgb?: {
      power: boolean;
      color: string;
      brightness: number;
      mode?: string;
    };
  };
}

export type NoticeDuration = '1h' | '24h' | 'never';

export interface NoticeItem {
  id: string;
  classroomId: string; // 'all' for broadcast, or 'cls-a101', 'cls-a102', etc.
  classroomName?: string;
  title: string;
  message: string;
  duration: NoticeDuration;
  postedBy?: string;
  createdAt: string;
  expiresAt?: string | null;
  isActive: boolean;
}

export type BellPattern =
  | 'japanese-school-bell'
  | 'westminster'
  | 'college-bell'
  | 'triple-chime'
  | 'lunch-fanfare'
  | 'dismissal-chime'
  | 'double-beep'
  | 'single-long'
  | 'ding-dong'
  | 'marimba-cascade'
  | 'st-michael'
  | 'digital-synth'
  | 'morning-reveille'
  | 'gentle-wind';

export interface TimetablePeriod {
  id: string;
  name: string;
  startTime: string; // "09:00" (HH:mm)
  endTime: string;   // "10:00"
  type: 'class' | 'break' | 'lunch' | 'lab';
  enabled: boolean;
  bellPattern?: BellPattern;
  days?: number[];   // e.g. [5] for Friday only, [1,2,3,4] for Mon-Thu. If omitted/empty, applies to all activeDays.
}

export interface TimetableConfig {
  enabled: boolean;
  activeDays: number[]; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  defaultPattern: BellPattern;
  periods: TimetablePeriod[];
}
