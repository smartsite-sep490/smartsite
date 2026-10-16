import { createContext, useContext, useSyncExternalStore } from 'react';
import {
  isForbiddenCatalogKey,
  LEGACY_LOCALE_STORAGE_KEY,
  readSafeStorageLocale,
  writeSafeStorageLocale,
} from './compat';
import { hasRegisteredFeatureKey, lookupFeatureTranslation } from './feature-catalog-registry';
import type { PpeTranslationKey } from './ppe-catalog';
import {
  changeUiLanguage,
  registerCoreSafetyCatalog,
  subscribeLanguageChange,
  translateSafetyNamespaceKey,
  uiLanguage,
} from './runtime';

export type Locale = 'vi' | 'en';

export const LOCALE_STORAGE_KEY = LEGACY_LOCALE_STORAGE_KEY;
export const DEFAULT_PROVIDER_LOCALE: Locale = 'vi';
export const STANDALONE_FALLBACK_LOCALE: Locale = 'en';

export function isSupportedLocale(value: unknown): value is Locale {
  return value === 'vi' || value === 'en';
}

const EN_CATALOG = {
  'locale.label': 'Language',
  'locale.switcherLabel': 'Switch language',
  'locale.vi': 'Tiếng Việt',
  'locale.en': 'English',

  'auth.login': 'Sign in',
  'auth.backToHomepageAria': 'Back to homepage',
  'auth.backToSite': 'Back to Site',
  'auth.badge': 'Safety Operations',
  'auth.subtitle': 'Enter your credentials to access the safety compliance monitoring workspace.',
  'auth.username': 'Username',
  'auth.usernamePlaceholder': 'Enter your username',
  'auth.password': 'Password',
  'auth.passwordPlaceholder': 'Enter your password',
  'auth.showPassword': 'Show password',
  'auth.hidePassword': 'Hide password',
  'auth.signingIn': 'Signing In...',
  'auth.noAccountPrompt': "Don't have an account? ",
  'auth.getAnAccount': 'Get an account',
  'auth.registerGuidance.eyebrow': 'Account access',
  'auth.registerGuidance.title': 'Get access to SmartSite',
  'auth.registerGuidance.adminInstruction':
    'Ask your SmartSite administrator to create your account and assign the roles you need.',
  'auth.registerGuidance.existingAccountPrompt':
    'Already have your account details? Sign in to continue.',
  'auth.notice.passwordChanged': 'Password changed. Please sign in with your new password.',
  'auth.footer': 'SmartSite Operational Safety Platform · Authorized Access Only',
  'auth.logout': 'Logout',
  'auth.restoringSession': 'Restoring session...',
  'auth.verifyingAccess': 'Verifying workspace access...',
  'auth.unableVerifyAccessTitle': 'Unable to verify workspace access',
  'auth.unableVerifyAccessDesc':
    'SmartSite could not load your role assignments right now. Retry before switching workspaces.',
  'auth.retryVerification': 'Retry verification',

  'auth.error.invalidCredentials': 'Invalid credentials.',
  'auth.error.tooManyAttempts': 'Too many attempts.',
  'auth.error.timeout': 'Sign in timed out. Please try again.',
  'auth.error.unavailable': 'Sign-in service is unavailable. Please try again.',
  'auth.error.invalidResponse': 'Sign-in service returned an invalid response. Please try again.',
  'auth.error.network': 'Connection failed.',
  'auth.error.unexpected': 'An unexpected error occurred.',

  'layout.skipToMain': 'Skip to main content',
  'layout.brandHomepage': 'SmartSite Homepage',
  'layout.operationsSubtitle': 'Operations',
  'layout.expandSidebar': 'Expand sidebar',
  'layout.collapseSidebar': 'Collapse sidebar',
  'layout.mainNavigation': 'Main navigation',
  'layout.publicHomepage': 'Public SmartSite Homepage',
  'layout.platformHeader': 'SmartSite Operations Platform',
  'layout.accountFallback': 'Account',
  'layout.logout': 'Logout',

  'nav.group.workspace': 'Workspace',
  'nav.group.safety': 'Safety',
  'nav.group.siteData': 'Site Data',
  'nav.dashboard': 'Dashboard',
  'nav.myScheduleRequests': 'My Schedule & Requests',
  'nav.contractorReview': 'Contractor Review',
  'nav.workforce': 'Workforce',
  'nav.scheduleSetup': 'Schedule Setup',
  'nav.siteSetup': 'Site Setup',
  'nav.access': 'Site Access',
  'nav.liveMonitoring': 'Live Monitoring',
  'nav.ppe': 'PPE Monitoring',
  'nav.zones': 'Restricted Zones',
  'nav.incidents': 'Safety Alerts',
  'nav.iot': 'IoT Monitoring',
  'nav.progress': 'Progress',

  'role.ADMIN': 'System Admin',
  'role.SITE_MANAGER': 'Site Manager',
  'role.SAFETY_OFFICER': 'Safety Officer',
  'role.CONTRACTOR_REPRESENTATIVE': 'Contractor Rep',
  'role.WORKER': 'Worker',
  'role.authenticatedUser': 'Authenticated User',
  'role.unverified': 'Access not verified',

  'domain.site': 'Site',
  'domain.zone': 'Zone',
  'domain.region': 'Camera Region',
  'domain.contractor': 'Contractor',
  'domain.crew': 'Crew',
  'domain.specialty': 'Specialty',
  'domain.authRole': 'Authorization Role',
  'domain.alert': 'Safety Alert',
  'domain.incident': 'Incident',
  'domain.reviewAlert': 'Review alert',
  'domain.unknown': 'Unknown',
  'domain.historicalOutcomeNote': 'Recorded outcome at assessment time (not current permission)',
} as const;

export type CoreTranslationKey = keyof typeof EN_CATALOG;
export type TranslationKey = CoreTranslationKey | PpeTranslationKey;
export type TranslationCatalog = Record<CoreTranslationKey, string>;

const VI_CATALOG: TranslationCatalog = {
  'locale.label': 'Ngôn ngữ',
  'locale.switcherLabel': 'Chuyển đổi ngôn ngữ',
  'locale.vi': 'Tiếng Việt',
  'locale.en': 'English',

  'auth.login': 'Đăng nhập',
  'auth.backToHomepageAria': 'Quay lại trang chủ',
  'auth.backToSite': 'Về trang chủ',
  'auth.badge': 'Vận hành an toàn',
  'auth.subtitle': 'Nhập thông tin tài khoản để truy cập không gian giám sát tuân thủ an toàn.',
  'auth.username': 'Tên đăng nhập',
  'auth.usernamePlaceholder': 'Nhập tên đăng nhập',
  'auth.password': 'Mật khẩu',
  'auth.passwordPlaceholder': 'Nhập mật khẩu',
  'auth.showPassword': 'Hiện mật khẩu',
  'auth.hidePassword': 'Ẩn mật khẩu',
  'auth.signingIn': 'Đang đăng nhập...',
  'auth.noAccountPrompt': 'Chưa có tài khoản? ',
  'auth.getAnAccount': 'Đăng ký tài khoản',
  'auth.registerGuidance.eyebrow': 'Quyền truy cập tài khoản',
  'auth.registerGuidance.title': 'Nhận quyền truy cập SmartSite',
  'auth.registerGuidance.adminInstruction':
    'Hãy liên hệ quản trị viên SmartSite để được tạo tài khoản và phân quyền vai trò phù hợp.',
  'auth.registerGuidance.existingAccountPrompt':
    'Đã có thông tin tài khoản? Đăng nhập để tiếp tục.',
  'auth.notice.passwordChanged': 'Đã đổi mật khẩu. Vui lòng đăng nhập bằng mật khẩu mới.',
  'auth.footer': 'Nền tảng An toàn Vận hành SmartSite · Chỉ dành cho người được cấp quyền',
  'auth.logout': 'Đăng xuất',
  'auth.restoringSession': 'Đang khôi phục phiên làm việc...',
  'auth.verifyingAccess': 'Đang xác minh quyền truy cập không gian làm việc...',
  'auth.unableVerifyAccessTitle': 'Không thể xác minh quyền truy cập',
  'auth.unableVerifyAccessDesc':
    'SmartSite hiện không thể tải phân quyền vai trò của bạn. Vui lòng thử lại trước khi chuyển không gian làm việc.',
  'auth.retryVerification': 'Thử xác minh lại',

  'auth.error.invalidCredentials': 'Thông tin đăng nhập không hợp lệ.',
  'auth.error.tooManyAttempts': 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau.',
  'auth.error.timeout': 'Quá thời gian đăng nhập. Vui lòng thử lại.',
  'auth.error.unavailable': 'Dịch vụ đăng nhập hiện không khả dụng. Vui lòng thử lại.',
  'auth.error.invalidResponse': 'Dịch vụ đăng nhập trả về phản hồi không hợp lệ. Vui lòng thử lại.',
  'auth.error.network': 'Kết nối thất bại.',
  'auth.error.unexpected': 'Đã xảy ra lỗi ngoài dự kiến.',

  'layout.skipToMain': 'Chuyển đến nội dung chính',
  'layout.brandHomepage': 'Trang chủ SmartSite',
  'layout.operationsSubtitle': 'Vận hành',
  'layout.expandSidebar': 'Mở rộng thanh bên',
  'layout.collapseSidebar': 'Thu gọn thanh bên',
  'layout.mainNavigation': 'Điều hướng chính',
  'layout.publicHomepage': 'Trang giới thiệu SmartSite',
  'layout.platformHeader': 'Nền tảng Vận hành Công trường SmartSite',
  'layout.accountFallback': 'Tài khoản',
  'layout.logout': 'Đăng xuất',

  'nav.group.workspace': 'Không gian làm việc',
  'nav.group.safety': 'An toàn',
  'nav.group.siteData': 'Dữ liệu công trường',
  'nav.dashboard': 'Tổng quan',
  'nav.myScheduleRequests': 'Lịch làm việc & Yêu cầu của tôi',
  'nav.contractorReview': 'Duyệt nhà thầu',
  'nav.workforce': 'Nhân sự công trường',
  'nav.scheduleSetup': 'Thiết lập lịch làm việc',
  'nav.siteSetup': 'Thiết lập công trường',
  'nav.access': 'Kiểm soát ra vào',
  'nav.liveMonitoring': 'Giám sát trực tiếp',
  'nav.ppe': 'Giám sát bảo hộ (PPE)',
  'nav.zones': 'Khu vực hạn chế',
  'nav.incidents': 'Cảnh báo an toàn',
  'nav.iot': 'Giám sát IoT',
  'nav.progress': 'Tiến độ thi công',

  'role.ADMIN': 'Quản trị hệ thống',
  'role.SITE_MANAGER': 'Quản lý công trường',
  'role.SAFETY_OFFICER': 'Cán bộ an toàn',
  'role.CONTRACTOR_REPRESENTATIVE': 'Đại diện nhà thầu',
  'role.WORKER': 'Công nhân',
  'role.authenticatedUser': 'Người dùng đã xác thực',
  'role.unverified': 'Chưa xác minh quyền truy cập',

  'domain.site': 'Công trường',
  'domain.zone': 'Khu vực',
  'domain.region': 'Vùng quan sát của camera',
  'domain.contractor': 'Nhà thầu',
  'domain.crew': 'Đội thợ',
  'domain.specialty': 'Chuyên môn',
  'domain.authRole': 'Vai trò phân quyền',
  'domain.alert': 'Cảnh báo an toàn',
  'domain.incident': 'Sự cố',
  'domain.reviewAlert': 'Xác minh cảnh báo',
  'domain.unknown': 'Chưa xác định',
  'domain.historicalOutcomeNote': 'Kết quả tại thời điểm đánh giá (không phải quyền hiện tại)',
};

export const CATALOGS: Record<Locale, TranslationCatalog> = {
  vi: VI_CATALOG,
  en: EN_CATALOG,
};

registerCoreSafetyCatalog(EN_CATALOG, VI_CATALOG);

export function readStoredLocale(storageKey: string): Locale | null {
  return readSafeStorageLocale(storageKey);
}

export function writeStoredLocale(storageKey: string, locale: Locale): void {
  writeSafeStorageLocale(storageKey, locale);
}

export function translateKey(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  if (typeof key !== 'string' || !key || isForbiddenCatalogKey(key)) {
    return '';
  }

  const activeLocale: Locale = isSupportedLocale(locale) ? locale : STANDALONE_FALLBACK_LOCALE;
  const isCoreKey = Object.prototype.hasOwnProperty.call(EN_CATALOG, key);
  const isFeatureKey = !isCoreKey && hasRegisteredFeatureKey(key);
  if (!isCoreKey && !isFeatureKey) {
    return '';
  }

  const coreCatalog = CATALOGS[activeLocale] ?? CATALOGS[STANDALONE_FALLBACK_LOCALE];
  const rawTemplate = isCoreKey
    ? Object.prototype.hasOwnProperty.call(coreCatalog, key)
      ? coreCatalog[key as CoreTranslationKey]
      : EN_CATALOG[key as CoreTranslationKey]
    : (lookupFeatureTranslation(activeLocale, key) ??
      lookupFeatureTranslation(STANDALONE_FALLBACK_LOCALE, key));

  if (typeof rawTemplate !== 'string') {
    return '';
  }

  if (!params) {
    if (!rawTemplate.includes('{')) {
      return translateSafetyNamespaceKey(activeLocale, key);
    }
    return rawTemplate;
  }

  const effectiveParams: Record<string, string | number> = {};
  for (const paramKey of Object.keys(params)) {
    const value = params[paramKey];
    if (Object.prototype.hasOwnProperty.call(params, paramKey) && value !== undefined) {
      effectiveParams[paramKey] = value;
    }
  }

  rawTemplate.replace(/\{(\w+)\}/g, (match, token: string) => {
    if (!Object.prototype.hasOwnProperty.call(effectiveParams, token)) {
      effectiveParams[token] = match;
    }
    return match;
  });

  return translateSafetyNamespaceKey(activeLocale, key, effectiveParams);
}

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (nextLocale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

const TRANSLATORS_BY_LOCALE: Record<
  Locale,
  (key: TranslationKey, params?: Record<string, string | number>) => string
> = {
  en: (key, params) => translateKey('en', key, params),
  vi: (key, params) => translateKey('vi', key, params),
};

export function getSharedTranslator(
  locale: Locale,
): (key: TranslationKey, params?: Record<string, string | number>) => string {
  return isSupportedLocale(locale) ? TRANSLATORS_BY_LOCALE[locale] : TRANSLATORS_BY_LOCALE.en;
}

export function setSharedRuntimeLocale(nextLocale: Locale): void {
  if (!isSupportedLocale(nextLocale)) {
    return;
  }
  changeUiLanguage(nextLocale, LOCALE_STORAGE_KEY);
}

const SHARED_CONTEXT_BY_LOCALE: Record<Locale, LocaleContextValue> = {
  en: {
    locale: 'en',
    setLocale: setSharedRuntimeLocale,
    t: TRANSLATORS_BY_LOCALE.en,
  },
  vi: {
    locale: 'vi',
    setLocale: setSharedRuntimeLocale,
    t: TRANSLATORS_BY_LOCALE.vi,
  },
};

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  const runtimeLocale = useSyncExternalStore(subscribeLanguageChange, uiLanguage, uiLanguage);
  return context ?? SHARED_CONTEXT_BY_LOCALE[runtimeLocale];
}
