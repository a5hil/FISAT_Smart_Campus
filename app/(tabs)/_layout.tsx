import { Tabs } from 'expo-router';
import React from 'react';
import { FloatingBottomNav } from '../../components/FloatingBottomNav';
import { useApp } from '../../context/AppContext';

export default function TabLayout() {
  const { colors } = useApp();

  return (
    <Tabs
      tabBar={(props: any) => <FloatingBottomNav {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home',
        }}
      />
      <Tabs.Screen
        name="classrooms"
        options={{
          title: 'Classrooms',
          tabBarAccessibilityLabel: 'Classrooms',
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: 'Notices',
          tabBarAccessibilityLabel: 'Notices',
        }}
      />
      <Tabs.Screen
        name="energy"
        options={{
          title: 'Energy',
          tabBarAccessibilityLabel: 'Energy',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarAccessibilityLabel: 'Settings',
        }}
      />
    </Tabs>
  );
}
