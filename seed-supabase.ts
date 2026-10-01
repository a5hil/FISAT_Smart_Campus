import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { mockCampus, mockClassrooms, mockAlerts, mockNotifications } from './mock_data/mockSeed';

function loadEnv(): Record<string, string> {
  const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(
  env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

const SETTING_KEYS = ['brightness', 'speed', 'temperature', 'mode', 'fanSpeed', 'volume', 'source', 'direction', 'colorTemp', 'ratedPower', 'color', 'rgbMode'] as const;

function extractSettings(dev: { [k: string]: unknown }): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const k of SETTING_KEYS) {
    if (dev[k] !== undefined) settings[k] = dev[k];
  }
  return settings;
}

async function clearAll(): Promise<void> {
  for (const t of ['devices', 'controllers', 'activity', 'alerts', 'notifications', 'classrooms', 'campuses']) {
    const { error } = await supabase.from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(`clear ${t}: ${error.message}`);
  }
}

async function run(): Promise<void> {
  console.log('Wiping previous seed data...');
  await clearAll();

  console.log('Seeding campus...');
  const { error: campusErr } = await supabase.from('campuses').upsert(
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: mockCampus.name,
      department: mockCampus.department,
      buildings: mockCampus.buildings,
    },
    { onConflict: 'id' },
  );
  if (campusErr) throw new Error(`campuses: ${campusErr.message}`);

  let clsCount = 0, ctrlCount = 0, devCount = 0, alertCount = 0, actCount = 0;

  for (const cls of mockClassrooms) {
    const { error: clsErr } = await supabase.from('classrooms').upsert(
      {
        id: cls.id,
        name: cls.name,
        room_number: cls.number,
        department: cls.department,
        building: cls.building,
        floor: cls.floor,
        capacity: cls.capacity,
        occupancy_status: cls.occupancy,
        status: cls.status,
        temperature: cls.temperature,
        current_load: cls.currentLoad,
        energy_today: cls.energyToday,
        estimated_cost: cls.estimatedCost,
      },
      { onConflict: 'id' },
    );
    if (clsErr) throw new Error(`classrooms ${cls.id}: ${clsErr.message}`);
    clsCount++;

    const { error: ctrlErr } = await supabase.from('controllers').upsert(
      {
        id: cls.controller.id,
        classroom_id: cls.id,
        name: cls.controller.name,
        type: cls.controller.type,
        status: cls.controller.status,
        signal_strength: cls.controller.signalStrength,
        ip_address: cls.controller.ipAddress,
        firmware_version: cls.controller.firmwareVersion,
        relay_channels: cls.controller.relayChannels,
        used_channels: cls.controller.usedChannels,
        last_seen: cls.controller.lastSeen,
      },
      { onConflict: 'id' },
    );
    if (ctrlErr) throw new Error(`controllers ${cls.controller.id}: ${ctrlErr.message}`);
    ctrlCount++;

    for (const dev of cls.devices) {
      const { error: devErr } = await supabase.from('devices').upsert(
        {
          id: dev.id,
          classroom_id: cls.id,
          controller_id: dev.controllerId,
          name: dev.name,
          category: dev.category,
          status: dev.status,
          relay_channel: dev.relayChannel,
          room_area: dev.roomArea,
          capabilities: dev.capabilities,
          settings: extractSettings(dev as unknown as Record<string, unknown>),
          power_usage: dev.powerUsage,
          energy_today: dev.energyToday,
          last_updated: dev.lastUpdated,
        },
        { onConflict: 'id' },
      );
      if (devErr) throw new Error(`devices ${dev.id}: ${devErr.message}`);
      devCount++;
    }

    for (const alert of cls.alerts) {
      const { error: alertErr } = await supabase.from('alerts').upsert(
        {
          id: alert.id,
          classroom_id: alert.classroomId,
          classroom_name: alert.classroomName,
          severity: alert.severity,
          message: alert.message,
          is_read: alert.isRead,
          created_at: alert.time,
        },
        { onConflict: 'id' },
      );
      if (alertErr) throw new Error(`alerts ${alert.id}: ${alertErr.message}`);
      alertCount++;
    }

    for (const activity of cls.recentActivity) {
      const { error: actErr } = await supabase.from('activity').insert({
        classroom_id: cls.id,
        action: activity.action,
        user: activity.user,
        created_at: activity.time,
      });
      if (actErr) throw new Error(`activity ${activity.action}: ${actErr.message}`);
      actCount++;
    }
  }

  for (const alert of mockAlerts) {
    const { error } = await supabase.from('alerts').upsert(
      {
        id: alert.id,
        classroom_id: alert.classroomId,
        classroom_name: alert.classroomName,
        severity: alert.severity,
        message: alert.message,
        is_read: alert.isRead,
        created_at: alert.time,
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error(`alerts ${alert.id}: ${error.message}`);
    alertCount++;
  }

  for (const notif of mockNotifications) {
    const { error } = await supabase.from('notifications').upsert(
      {
        id: notif.id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        classroom_id: notif.classroomId ?? null,
        classroom_name: notif.classroomName ?? null,
        is_read: notif.isRead,
        created_at: notif.time,
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error(`notifications ${notif.id}: ${error.message}`);
  }

  console.log(
    `DONE: ${clsCount} classrooms, ${ctrlCount} controllers, ${devCount} devices, ${alertCount} alerts, ${actCount} activity rows, ${mockNotifications.length} notifications, 1 campus`,
  );
}

run().catch((e) => {
  console.error('SEED FAILED:', e.message);
  process.exit(1);
});