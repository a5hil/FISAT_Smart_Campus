import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '../context/AppContext';

export default function Index() {
  const router = useRouter();
  const { isAuthenticated, colors } = useApp();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isAuthenticated) {
        router.replace('/(tabs)' as any);
      } else {
        router.replace('/sign-in' as any);
      }
    }, 10);
    return () => clearTimeout(timer);
  }, [isAuthenticated, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors?.background || '#09090B', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={colors?.primary || '#F59E0B'} />
    </View>
  );
}
