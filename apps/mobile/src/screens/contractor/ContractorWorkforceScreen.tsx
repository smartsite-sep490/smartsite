import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
} from 'react-native';
import { colors } from '../../theme/colors';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import { IconChevronDown } from '../../components/common/Icons';

export interface ContractorWorkerRecord {
  id: string;
  name: string;
  initials: string;
  avatarBg: string;
  avatarColor: string;
  code: string;
  team: string;
  status: 'inside' | 'outside' | 'not_in' | 'suspended';
  statusText: string;
}

const WORKERS_DATA: ContractorWorkerRecord[] = [
  {
    id: 'w-1',
    name: 'Nguyễn Văn An',
    initials: 'NA',
    avatarBg: '#DBEAFE',
    avatarColor: '#1D4ED8',
    code: 'W000123',
    team: 'Thi công 01',
    status: 'inside',
    statusText: 'Trong công trường',
  },
  {
    id: 'w-2',
    name: 'Lê Văn Bình',
    initials: 'LB',
    avatarBg: '#FFEDD5',
    avatarColor: '#C2410C',
    code: 'W000124',
    team: 'Thi công 01',
    status: 'outside',
    statusText: 'Ngoài công trường',
  },
  {
    id: 'w-3',
    name: 'Phạm Thị Hoa',
    initials: 'PH',
    avatarBg: '#DCFCE7',
    avatarColor: '#15803D',
    code: 'W000131',
    team: 'Cốp pha 02',
    status: 'inside',
    statusText: 'Trong công trường',
  },
  {
    id: 'w-4',
    name: 'Trần Văn Cường',
    initials: 'TC',
    avatarBg: '#F1F5F9',
    avatarColor: '#475569',
    code: 'W000140',
    team: 'Cốt thép 03',
    status: 'not_in',
    statusText: 'Chưa vào',
  },
  {
    id: 'w-5',
    name: 'Đỗ Minh Đức',
    initials: 'ĐĐ',
    avatarBg: '#FFE4E6',
    avatarColor: '#BE123C',
    code: 'W000152',
    team: 'Thi công 01',
    status: 'inside',
    statusText: 'Trong công trường',
  },
  {
    id: 'w-6',
    name: 'Võ Thị Lan',
    initials: 'VL',
    avatarBg: '#F3E8FF',
    avatarColor: '#7E22CE',
    code: 'W000158',
    team: 'Cốp pha 02',
    status: 'suspended',
    statusText: 'Tạm ngưng',
  },
];

interface ContractorWorkforceScreenProps {
  onBack?: () => void;
  onSelectWorker?: (worker: ContractorWorkerRecord) => void;
  onAddWorker?: () => void;
}

export function ContractorWorkforceScreen({
  onBack,
  onSelectWorker,
  onAddWorker,
}: ContractorWorkforceScreenProps) {
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = WORKERS_DATA.filter((w) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        w.name.toLowerCase().includes(q) ||
        w.code.toLowerCase().includes(q) ||
        w.team.toLowerCase().includes(q);
      if (!match) return false;
    }
    if (statusFilter !== 'all' && w.status !== statusFilter) return false;
    if (teamFilter !== 'all' && !w.team.includes(teamFilter)) return false;
    return true;
  });

  return (
    <View style={styles.container}>
      <ScreenHeader
        mode={onBack ? 'detail' : 'root'}
        onBack={onBack}
        tagline="Kết nối con người, xây dựng tương lai"
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Nhân sự</Text>
          <Text style={styles.subtitle}>Nhà thầu An Phát · 24 công nhân</Text>
        </View>

        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Tìm theo tên hoặc mã công nhân"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Filter Dropdowns Row */}
        <View style={styles.filtersRow}>
          <Pressable
            style={styles.filterDropdown}
            onPress={() => setTeamFilter(teamFilter === 'all' ? 'Thi công 01' : 'all')}
          >
            <Text style={styles.filterDropdownText}>
              {teamFilter === 'all' ? 'Tất cả đội' : teamFilter}
            </Text>
            <IconChevronDown size={16} color={colors.textMuted} />
          </Pressable>

          <Pressable
            style={styles.filterDropdown}
            onPress={() => setStatusFilter(statusFilter === 'all' ? 'inside' : 'all')}
          >
            <Text style={styles.filterDropdownText}>
              {statusFilter === 'all' ? 'Trạng thái' : 'Trong công trường'}
            </Text>
            <IconChevronDown size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Workers List */}
        <View style={styles.workersList}>
          {filtered.map((w) => {
            const isInside = w.status === 'inside';
            const isOutside = w.status === 'outside';
            const isSuspended = w.status === 'suspended';

            return (
              <Pressable
                key={w.id}
                style={({ pressed }) => [styles.workerItem, pressed && { opacity: 0.88 }]}
                onPress={() => onSelectWorker?.(w)}
              >
                {/* Colored Initials Avatar */}
                <View style={[styles.avatarCircle, { backgroundColor: w.avatarBg }]}>
                  <Text style={[styles.avatarText, { color: w.avatarColor }]}>{w.initials}</Text>
                </View>

                {/* Name & Code / Team */}
                <View style={styles.workerInfo}>
                  <Text style={styles.workerName}>{w.name}</Text>
                  <Text style={styles.workerCode}>
                    {w.code} · {w.team}
                  </Text>
                </View>

                {/* Status Pill Badge */}
                <View
                  style={[
                    styles.statusPill,
                    isInside && { backgroundColor: '#EDFAF2' },
                    isOutside && { backgroundColor: '#FEF3C7' },
                    w.status === 'not_in' && { backgroundColor: '#F1F5F9' },
                    isSuspended && { backgroundColor: '#F1F5F9' },
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      isInside && { backgroundColor: colors.success },
                      isOutside && { backgroundColor: colors.warning },
                      w.status === 'not_in' && { backgroundColor: '#64748B' },
                      isSuspended && { backgroundColor: '#64748B' },
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusText,
                      isInside && { color: colors.successText },
                      isOutside && { color: '#B45309' },
                      w.status === 'not_in' && { color: colors.textSecondary },
                      isSuspended && { color: colors.textSecondary },
                    ]}
                  >
                    {w.statusText}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Floating Action Button: + Thêm công nhân (Image 4) */}
      <View style={styles.fabContainer}>
        <Pressable
          style={({ pressed }) => [styles.fabBtn, pressed && { opacity: 0.9 }]}
          onPress={onAddWorker}
        >
          <Text style={styles.fabText}>+ Thêm công nhân</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 80,
  },
  titleSection: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    gap: 10,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  filterDropdown: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8F9FB',
    borderWidth: 1,
    borderColor: '#EFF2F6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  filterDropdownText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  workersList: {
    gap: 12,
  },
  workerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FB',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    gap: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
  },
  workerInfo: {
    flex: 1,
  },
  workerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1E36',
    marginBottom: 2,
  },
  workerCode: {
    fontSize: 12,
    color: colors.textMuted,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  fabContainer: {
    position: 'absolute',
    bottom: 20,
    right: 20,
  },
  fabBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  fabText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
