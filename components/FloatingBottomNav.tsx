import React from 'react';
import { View, StyleSheet, TouchableOpacity, useWindowDimensions, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { useApp } from '../context/AppContext';

type NavRoute = {
  key: string;
  name: string;
  params?: object;
};

type FloatingBottomNavProps = {
  state?: {
    index: number;
    routes: NavRoute[];
  };
  descriptors?: Record<string, { options: { tabBarAccessibilityLabel?: string } }>;
  navigation?: {
    emit: (event: { type: string; target: string; canPreventDefault: boolean }) => { defaultPrevented: boolean };
    navigate: (name: string, params?: object) => void;
  };
  activeTab?: 'index' | 'classrooms' | 'announcements' | 'energy' | 'settings';
};

const iconMap: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  index: { active: 'home', inactive: 'home-outline' },
  classrooms: { active: 'business', inactive: 'business-outline' },
  announcements: { active: 'megaphone', inactive: 'megaphone-outline' },
  energy: { active: 'flash', inactive: 'flash-outline' },
  settings: { active: 'settings', inactive: 'settings-outline' },
};

const STANDALONE_TABS: { key: string; name: 'index' | 'classrooms' | 'announcements' | 'energy' | 'settings'; label: string; href: string }[] = [
  { key: 'index', name: 'index', label: 'Home', href: '/(tabs)' },
  { key: 'classrooms', name: 'classrooms', label: 'Classrooms', href: '/(tabs)/classrooms' },
  { key: 'announcements', name: 'announcements', label: 'Notices', href: '/(tabs)/announcements' },
  { key: 'energy', name: 'energy', label: 'Energy', href: '/(tabs)/energy' },
  { key: 'settings', name: 'settings', label: 'Settings', href: '/(tabs)/settings' },
];

import { triggerHaptic } from '../utils/haptics';

export function FloatingBottomNav({ state, descriptors, navigation, activeTab }: FloatingBottomNavProps) {
  const { colors, isDark } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();

  const isTabsMode = !!(state && descriptors && navigation);
  const routeCount = isTabsMode ? state.routes.length : STANDALONE_TABS.length;
  const isFiveTabs = routeCount >= 5;
  const navWidth = Math.min(isFiveTabs ? 356 : Layout.nav.width, width - 24);
  const bottomPadding = Math.max(insets.bottom, 16);
  const btnSize = isFiveTabs ? 52 : Layout.nav.circleSize;

  const getStandaloneActiveTab = () => {
    if (activeTab) return activeTab;
    if (pathname.includes('classroom')) return 'classrooms';
    if (pathname.includes('announcement')) return 'announcements';
    if (pathname.includes('energy')) return 'energy';
    if (pathname.includes('setting')) return 'settings';
    if (pathname.includes('device')) return 'classrooms';
    return null;
  };
  const standaloneActive = getStandaloneActiveTab();

  const navBg = isDark
    ? (Platform.OS === 'android' ? 'rgba(30, 30, 30, 0.88)' : 'rgba(15, 15, 15, 0.65)')
    : (Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.96)' : 'rgba(255, 255, 255, 0.88)');

  const inactiveBtnBg = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';

  return (
    <View style={[styles.container, { bottom: bottomPadding, left: (width - navWidth) / 2 }]}>
      <BlurView
        intensity={Platform.OS === 'ios' ? 80 : 100}
        tint={isDark ? 'dark' : 'light'}
        style={[
          styles.blurContainer,
          {
            width: navWidth,
            height: isFiveTabs ? 72 : Layout.nav.height,
            borderRadius: isFiveTabs ? 36 : 41,
            backgroundColor: navBg,
            borderColor: colors.surfaceBorder,
          },
        ]}
        blurMethod="none"
      >
        <View style={styles.navContent}>
          {isTabsMode
            ? state!.routes.map((route, index) => {
                const { options } = descriptors![route.key];
                const isFocused = state!.index === index;

                const onPress = () => {
                  triggerHaptic.light();
                  const event = navigation!.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });

                  if (!isFocused && !event.defaultPrevented) {
                    navigation!.navigate(route.name, route.params);
                  }
                };

                const icons = iconMap[route.name] || iconMap.index;
                const iconName = isFocused ? icons.active : icons.inactive;

                return (
                  <TouchableOpacity
                    key={route.key}
                    accessibilityRole="button"
                    accessibilityState={isFocused ? { selected: true } : {}}
                    accessibilityLabel={options.tabBarAccessibilityLabel || route.name}
                    onPress={onPress}
                    style={[
                      styles.tabButton,
                      {
                        width: btnSize,
                        height: btnSize,
                        borderRadius: btnSize / 2,
                        backgroundColor: isFocused ? colors.primary : inactiveBtnBg,
                      },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={iconName}
                      size={isFiveTabs ? 22 : 24}
                      color={isFocused ? '#FFFFFF' : colors.textSecondary}
                    />
                  </TouchableOpacity>
                );
              })
            : STANDALONE_TABS.map((tab) => {
                const isFocused = standaloneActive === tab.name;
                const icons = iconMap[tab.name] || iconMap.index;
                const iconName = isFocused ? icons.active : icons.inactive;

                const onPress = () => {
                  triggerHaptic.light();
                  router.navigate(tab.href as any);
                };

                return (
                  <TouchableOpacity
                    key={tab.key}
                    accessibilityRole="button"
                    accessibilityState={isFocused ? { selected: true } : {}}
                    accessibilityLabel={tab.label}
                    onPress={onPress}
                    style={[
                      styles.tabButton,
                      {
                        width: btnSize,
                        height: btnSize,
                        borderRadius: btnSize / 2,
                        backgroundColor: isFocused ? colors.primary : inactiveBtnBg,
                      },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={iconName}
                      size={isFiveTabs ? 22 : 24}
                      color={isFocused ? '#FFFFFF' : colors.textSecondary}
                    />
                  </TouchableOpacity>
                );
              })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  blurContainer: {
    height: Layout.nav.height,
    borderRadius: 41,
    overflow: 'hidden',
    backgroundColor: Platform.OS === 'android' ? 'rgba(30, 30, 30, 0.75)' : 'rgba(10, 10, 10, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  navContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: 4,
  },
  tabButton: {
    width: Layout.nav.circleSize,
    height: Layout.nav.circleSize,
    borderRadius: Layout.nav.circleSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceTranslucent,
  },
  tabButtonActive: {
    backgroundColor: Colors.primary,
  },
});
