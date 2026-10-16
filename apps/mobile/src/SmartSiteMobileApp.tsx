import React, { useState } from 'react';
import { View, StyleSheet, SafeAreaView, StatusBar, Platform } from 'react-native';
import { SplashScreen } from './screens/splash/SplashScreen';
import { LoginScreen } from './screens/auth/LoginScreen';
import { WorkerHomeScreen } from './screens/worker/WorkerHomeScreen';
import { WorkerScheduleScreen } from './screens/worker/WorkerScheduleScreen';
import { WorkerAttendanceDetailScreen } from './screens/worker/WorkerAttendanceDetailScreen';
import { WorkerRequestScreen } from './screens/worker/WorkerRequestScreen';
import { WorkerQrScreen } from './screens/worker/WorkerQrScreen';
import { WorkerNotificationsScreen } from './screens/worker/WorkerNotificationsScreen';
import { ContractorHomeScreen } from './screens/contractor/ContractorHomeScreen';
import { ContractorRequestsScreen } from './screens/contractor/ContractorRequestsScreen';
import { ContractorRequestDetailScreen } from './screens/contractor/ContractorRequestDetailScreen';
import { ContractorWorkforceScreen, ContractorWorkerRecord } from './screens/contractor/ContractorWorkforceScreen';
import { ContractorWorkerDetailScreen } from './screens/contractor/ContractorWorkerDetailScreen';
import { ContractorScheduleAssignScreen } from './screens/contractor/ContractorScheduleAssignScreen';
import { ContractorSafetyChecklistScreen } from './screens/contractor/ContractorSafetyChecklistScreen';
import { ProfileScreen } from './screens/profile/ProfileScreen';
import { BottomTabBar, WorkerTab, ContractorTab } from './components/common/BottomTabBar';

export type UserRole = 'worker' | 'contractor';
type ActiveSubScreen =
  | 'none'
  | 'profile'
  | 'request'
  | 'attendanceDetail'
  | 'qr'
  | 'notifications'
  | 'contractorWorkerDetail'
  | 'contractorScheduleAssign'
  | 'contractorRequestDetail'
  | 'contractorSafetyChecklist';

export function SmartSiteMobileApp() {
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [role, setRole] = useState<UserRole>('worker');
  const [workerTab, setWorkerTab] = useState<WorkerTab>('home');
  const [contractorTab, setContractorTab] = useState<ContractorTab>('home');
  const [subScreen, setSubScreen] = useState<ActiveSubScreen>('none');
  const [requestTabType, setRequestTabType] = useState<'leave' | 'overtime' | 'adjustment'>('leave');
  const [selectedWorker, setSelectedWorker] = useState<ContractorWorkerRecord | null>(null);

  // 1. Animated Splash Screen
  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  // 2. Authentication Screen
  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#0F1E36" />
        <LoginScreen
          onLogin={(chosenRole) => {
            setRole(chosenRole);
            setIsLoggedIn(true);
            setWorkerTab('home');
            setContractorTab('home');
            setSubScreen('none');
          }}
        />
      </SafeAreaView>
    );
  }

  // Sub-screen 1: QR Dự phòng (Batch 2 - Image 1)
  if (subScreen === 'qr') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <WorkerQrScreen
          onBack={() => setSubScreen('none')}
          workerName="Nguyễn Văn An"
          workerCode="W000123"
          siteName="Công trường Riverside · Cổng chính"
        />
      </SafeAreaView>
    );
  }

  // Sub-screen 2: Thông báo (Batch 2 - Image 2)
  if (subScreen === 'notifications') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <WorkerNotificationsScreen
          onBack={() => setSubScreen('none')}
          onSelectNotification={() => {
            setSubScreen('attendanceDetail');
          }}
        />
      </SafeAreaView>
    );
  }

  // Sub-screen 3: Gửi yêu cầu (Batch 1 - Image 5)
  if (subScreen === 'request') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <WorkerRequestScreen
          initialTab={requestTabType}
          onBack={() => setSubScreen('none')}
        />
      </SafeAreaView>
    );
  }

  // Sub-screen 4: Chi tiết chấm công (Batch 1 - Image 4)
  if (subScreen === 'attendanceDetail') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <WorkerAttendanceDetailScreen
          onBack={() => setSubScreen('none')}
          onRequestAdjustment={() => {
            setRequestTabType('adjustment');
            setSubScreen('request');
          }}
        />
      </SafeAreaView>
    );
  }

  // Sub-screen 5: Hồ sơ công nhân cho Nhà thầu (Batch 2 - Image 5)
  if (subScreen === 'contractorWorkerDetail') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <ContractorWorkerDetailScreen
          onBack={() => setSubScreen('none')}
          workerName={selectedWorker?.name || 'Nguyễn Văn An'}
          workerCode={selectedWorker?.code || 'W000123'}
          team={selectedWorker?.team ? `Đội ${selectedWorker.team}` : 'Đội Thi công 01'}
        />
      </SafeAreaView>
    );
  }

  // Sub-screen 6: Phân lịch làm việc cho Nhà thầu (Batch 3 - Image 1)
  if (subScreen === 'contractorScheduleAssign') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <ContractorScheduleAssignScreen
          onBack={() => setSubScreen('none')}
          onSuccess={() => setSubScreen('none')}
        />
      </SafeAreaView>
    );
  }

  // Sub-screen 7: Chi tiết phê duyệt yêu cầu (Batch 3 - Image 3)
  if (subScreen === 'contractorRequestDetail') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <ContractorRequestDetailScreen
          onBack={() => setSubScreen('none')}
          onApproveSuccess={() => setSubScreen('none')}
          onRejectSuccess={() => setSubScreen('none')}
        />
      </SafeAreaView>
    );
  }

  // Sub-screen 8: Checklist an toàn (Batch 3 - Image 4)
  // Sub-screen 8: Checklist an toàn (Batch 3 - Image 4)
  if (subScreen === 'contractorSafetyChecklist') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <ContractorSafetyChecklistScreen
          onBack={() => setSubScreen('none')}
          onSubmitSuccess={() => setSubScreen('none')}
        />
      </SafeAreaView>
    );
  }

  // Sub-screen 9: Hồ sơ & Thiết lập tài khoản
  if (subScreen === 'profile') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <ProfileScreen
          role={role}
          onSwitchRole={(newRole) => setRole(newRole)}
          onLogout={() => {
            setIsLoggedIn(false);
            setSubScreen('none');
          }}
        />
      </SafeAreaView>
    );
  }

  // Main Tab Navigation Body
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={styles.container}>
        {/* Content Area */}
        <View style={styles.contentArea}>
          {role === 'worker' ? (
            <>
              {workerTab === 'home' && (
                <WorkerHomeScreen
                  onNavigateToSchedule={() => setWorkerTab('schedule')}
                  onNavigateToAttendance={() => setSubScreen('attendanceDetail')}
                  onNavigateToRequest={() => {
                    setRequestTabType('leave');
                    setSubScreen('request');
                  }}
                  onNotificationPress={() => setSubScreen('notifications')}
                />
              )}
              {workerTab === 'schedule' && (
                <WorkerScheduleScreen
                  onNavigateToRequest={(type) => {
                    setRequestTabType(type === 'swap' ? 'leave' : 'overtime');
                    setSubScreen('request');
                  }}
                  onSelectShift={() => setSubScreen('attendanceDetail')}
                />
              )}
              {workerTab === 'attendance' && (
                <WorkerAttendanceDetailScreen
                  onBack={() => setWorkerTab('home')}
                  onRequestAdjustment={() => {
                    setRequestTabType('adjustment');
                    setSubScreen('request');
                  }}
                />
              )}
              {workerTab === 'profile' && (
                <ProfileScreen
                  role="worker"
                  onSwitchRole={(newRole) => setRole(newRole)}
                  onLogout={() => setIsLoggedIn(false)}
                />
              )}
            </>
          ) : (
            <>
              {contractorTab === 'home' && (
                <ContractorHomeScreen
                  onNavigateToRequests={() => setContractorTab('requests')}
                  onNavigateToWorkforce={() => setContractorTab('workforce')}
                  onNavigateToSchedule={() => setSubScreen('contractorScheduleAssign')}
                  onNavigateToChecklist={() => setSubScreen('contractorSafetyChecklist')}
                  onNotificationPress={() => setSubScreen('notifications')}
                  onAvatarPress={() => setSubScreen('profile')}
                />
              )}
              {contractorTab === 'workforce' && (
                <ContractorWorkforceScreen
                  onSelectWorker={(w) => {
                    setSelectedWorker(w);
                    setSubScreen('contractorWorkerDetail');
                  }}
                  onAddWorker={() => {
                    setSelectedWorker(null);
                    setSubScreen('contractorWorkerDetail');
                  }}
                />
              )}
              {contractorTab === 'schedule' && (
                <ContractorScheduleAssignScreen
                  onBack={() => setContractorTab('home')}
                  onSuccess={() => setContractorTab('workforce')}
                />
              )}
              {contractorTab === 'requests' && (
                <ContractorRequestsScreen
                  onSelectRequest={() => setSubScreen('contractorRequestDetail')}
                />
              )}
            </>
          )}
        </View>

        {/* Persistent Bottom Tab Bar */}
        <BottomTabBar
          role={role}
          activeTab={role === 'worker' ? workerTab : contractorTab}
          onSelectTab={(tab) => {
            if (role === 'worker') {
              setWorkerTab(tab as WorkerTab);
            } else {
              setContractorTab(tab as ContractorTab);
            }
          }}
          pendingRequestsCount={5}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'android' ? 24 : 0,
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentArea: {
    flex: 1,
  },
});
