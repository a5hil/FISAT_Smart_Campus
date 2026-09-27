import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import { Layout } from '../../constants/layout';
import { ScreenHeader } from '../../components/ScreenHeader';
import { ClassroomCard } from '../../components/ClassroomCard';
import { useApp, useTheme } from '../../context/AppContext';
import { Ionicons } from '@expo/vector-icons';

type FilterType = 'All' | 'Occupied' | 'Vacant' | 'Offline';

export default function ClassroomsScreen() {
  const { classrooms } = useApp();
  const { colors, isDark } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('All');
  const [isSearching, setIsSearching] = useState(false);

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const filteredClassrooms = classrooms.filter(cls => {
    // Text search
    const matchesSearch = cls.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          cls.number.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Status filter
    let matchesFilter = true;
    if (activeFilter === 'Occupied') matchesFilter = cls.occupancy === 'occupied' && cls.status === 'online';
    else if (activeFilter === 'Vacant') matchesFilter = cls.occupancy === 'vacant' && cls.status === 'online';
    else if (activeFilter === 'Offline') matchesFilter = cls.status === 'offline';

    return matchesSearch && matchesFilter;
  });

  return (
    <View style={styles.container}>
      <ScreenHeader 
        title="Classrooms" 
        rightElement={
          <TouchableOpacity onPress={() => setIsSearching(!isSearching)}>
            <Ionicons name="search" size={24} color={colors.text} />
          </TouchableOpacity>
        }
      />

      {isSearching && (
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search classrooms..."
              placeholderTextColor={colors.inputPlaceholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <View style={styles.filtersContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersScroll}>
          {(['All', 'Occupied', 'Vacant', 'Offline'] as FilterType[]).map(filter => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.filterChip,
                activeFilter === filter && styles.filterChipActive
              ]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text style={[
                styles.filterText,
                activeFilter === filter && styles.filterTextActive
              ]}>
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView 
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
      >
        {filteredClassrooms.length > 0 ? (
          filteredClassrooms.map(cls => (
            <ClassroomCard key={cls.id} classroom={cls} />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="business-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No classrooms found</Text>
            <Text style={styles.emptySubtitle}>Try adjusting your search or filters.</Text>
          </View>
        )}
        
        {/* Bottom padding for floating nav */}
        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

function getStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    searchContainer: {
      paddingHorizontal: Layout.spacing.md,
      marginBottom: 16,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: Layout.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      marginLeft: 8,
    },
    filtersContainer: {
      marginBottom: 16,
    },
    filtersScroll: {
      paddingHorizontal: Layout.spacing.md,
      gap: 8,
    },
    filterChip: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: Layout.radius.round,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    filterChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    filterTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
    },
    listContainer: {
      paddingHorizontal: Layout.spacing.md,
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 64,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginTop: 16,
      marginBottom: 8,
    },
    emptySubtitle: {
      color: colors.textMuted,
      fontSize: 14,
    },
  });
}
