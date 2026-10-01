import React, { useEffect } from 'react';
import { Platform, StatusBar as RNStatusBar } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { AppProvider, useApp } from '../context/AppContext';
import { ToastNotification } from '../components/ToastNotification';

function ToastRenderer() {
  const { toast, hideToast } = useApp();
  if (!toast) return null;
  return <ToastNotification key={toast.id} message={toast.message} type={toast.type} onHide={hideToast} />;
}

function AppContent() {
  const { colors, isDark } = useApp();

  useEffect(() => {
    if (Platform.OS === 'android') {
      RNStatusBar.setBackgroundColor(colors.background, true);
      try {
        NavigationBar.setStyle(isDark ? 'dark' : 'light');
      } catch {}
    }
    RNStatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content', true);
  }, [isDark, colors.background]);

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="forget-password" />
        <Stack.Screen name="verify-email" />
        <Stack.Screen name="new-password" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="classroom/[id]" />
        <Stack.Screen name="device/[id]" />
        <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="timetable" options={{ animation: 'slide_from_right' }} />
      </Stack>
      <ToastRenderer />
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
