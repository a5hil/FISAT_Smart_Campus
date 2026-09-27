import {
  User, Campus, Classroom, Controller, Device, Alert,
  NotificationItem, ActivityItem, EnergyReading,
  DeviceCategory, DeviceCapability,
} from '../types';

export const mockUser: User = {
  name: 'Nershel Nelson',
  initials: 'NN',
  role: 'Department Administrator',
  email: 'nershel@fisat.ac.in',
};

export const mockCampus: Campus = {
  name: 'FISAT',
  department: 'IMCA Department',
  buildings: ['Block A', 'Idea Lab'],
};

const now = new Date().toISOString();
const mins = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const hours = (h: number) => new Date(Date.now() - h * 3600000).toISOString();

// Single ESP32 Dual-Classroom Controller
const defaultIp = process.env.EXPO_PUBLIC_DEFAULT_ESP32_IP || '192.168.1.101';

const esp32Controller: Controller = {
  id: 'ctrl-esp32',
  name: 'ESP32 Dual-Controller',
  type: 'ESP32-WROOM-32',
  status: 'online',
  signalStrength: 'strong',
  relayChannels: 6,
  usedChannels: [1, 2, 3, 4, 5, 6],
  ipAddress: defaultIp,
  firmwareVersion: '2.4.1',
  lastSeen: now,
};

function makeDev(
  id: string, name: string, category: DeviceCategory, status: 'on' | 'off' | 'offline',
  relay: number, area: string, power: number,
  caps: Partial<DeviceCapability> = {},
): Device {
  return {
    id,
    name,
    category,
    status,
    controllerId: 'ctrl-esp32',
    relayChannel: relay,
    roomArea: area,
    capabilities: { power: true, ...caps },
    powerUsage: status === 'on' ? power : 0,
    ratedPower: power,
    energyToday: 0.0,
    lastUpdated: mins(5),
  };
}

// ─── Classroom A101 (Classroom 1) ──────────────────────────────────
export const devsA101: Device[] = [
  makeDev('dev-a101-light-1', 'Main Lights', 'light', 'off', 1, 'Ceiling', 60),
  makeDev('dev-a101-fan-1', 'Ceiling Fan', 'fan', 'off', 2, 'Center', 75),
  makeDev('dev-a101-curtain', 'Motorized Curtains', 'curtain', 'off', 18, 'Windows', 5),
  makeDev('dev-a101-notice-board', 'Notice Board', 'display', 'on', 13, 'Entrance Wall', 2),
  makeDev('dev-a101-smart-screen', 'Smart Screen', 'display', 'on', 21, 'Podium Desk', 2),
];

// ─── Classroom A102 (Classroom 2) ──────────────────────────────────
const devsA102: Device[] = [
  makeDev('dev-a102-light-1', 'Main Lights', 'light', 'off', 3, 'Ceiling', 60),
  makeDev('dev-a102-fan-1', 'Ceiling Fan', 'fan', 'off', 4, 'Center', 75),
  makeDev('dev-a102-curtain', 'Motorized Curtains', 'curtain', 'off', 19, 'Windows', 5),
];

// ─── Corridor Zone ─────────────────────────────────────────────────
const devsCorridor: Device[] = [
  makeDev('dev-corr-light-1', 'Corridor Light 1', 'light', 'off', 5, 'North Wing', 40),
  makeDev('dev-corr-light-2', 'Corridor Light 2', 'light', 'off', 6, 'South Wing', 40),
];

function makeActivity(id: string, action: string, user: string, time: string, classroomId?: string): ActivityItem {
  return { id, action, user, time, classroomId };
}

export const mockClassrooms: Classroom[] = [
  {
    id: 'cls-a101',
    name: 'Classroom A101',
    number: 'A101',
    department: 'IMCA',
    building: 'Block A',
    floor: '1st Floor',
    capacity: 60,
    occupancy: 'vacant',
    status: 'online',
    temperature: 25.0,
    currentLoad: 0,
    energyToday: 0.0,
    estimatedCost: 0.0,
    voltage: 0.0,
    current: 0.0,
    hasPowerMeter: true,
    controller: esp32Controller,
    devices: devsA101,
    alerts: [],
    recentActivity: [
      makeActivity('act-1', 'Hardware initialized', 'System', mins(2), 'cls-a101'),
    ],
  },
  {
    id: 'cls-a102',
    name: 'Classroom A102',
    number: 'A102',
    department: 'IMCA',
    building: 'Block A',
    floor: '1st Floor',
    capacity: 40,
    occupancy: 'vacant',
    status: 'online',
    temperature: 25.0,
    currentLoad: 0,
    energyToday: 0.0,
    estimatedCost: 0.0,
    voltage: 0,
    current: 0,
    hasPowerMeter: false,
    controller: esp32Controller,
    devices: devsA102,
    alerts: [],
    recentActivity: [
      makeActivity('act-2', 'Hardware initialized', 'System', mins(2), 'cls-a102'),
    ],
  },
  {
    id: 'cls-corridor',
    name: 'Corridors & Hallways',
    number: 'CR-01',
    department: 'IMCA',
    building: 'Block A',
    floor: '1st Floor',
    capacity: 0,
    occupancy: 'vacant',
    status: 'online',
    temperature: 25.0,
    currentLoad: 0,
    energyToday: 0.0,
    estimatedCost: 0.0,
    voltage: 0,
    current: 0,
    hasPowerMeter: false,
    controller: esp32Controller,
    devices: devsCorridor,
    alerts: [],
    recentActivity: [
      makeActivity('act-3', 'LDR ambient light sensors active', 'System', mins(2), 'cls-corridor'),
    ],
  },
];

export const mockAlerts: Alert[] = [];

export const mockNotifications: NotificationItem[] = [
  { id: 'notif-1', type: 'controller-reconnected', title: 'ESP32 Online', message: 'Dual-zone controller ready for demo', time: mins(1), isRead: false },
];

export const mockEnergyData: { hourly: EnergyReading[]; daily: EnergyReading[]; weekly: EnergyReading[] } = {
  hourly: Array.from({ length: 24 }, (_, i) => ({
    time: `${i.toString().padStart(2, '0')}:00`,
    value: 0.0,
  })),
  daily: [
    { time: 'Mon', value: 0.0 }, { time: 'Tue', value: 0.0 },
    { time: 'Wed', value: 0.0 }, { time: 'Thu', value: 0.0 },
    { time: 'Fri', value: 0.0 }, { time: 'Sat', value: 0.0 },
    { time: 'Sun', value: 0.0 },
  ],
  weekly: [
    { time: 'Week 1', value: 0.0 }, { time: 'Week 2', value: 0.0 },
    { time: 'Week 3', value: 0.0 }, { time: 'Current', value: 0.0 },
  ],
};
