export interface RegisterMobilePushCommand {
  installationSecret: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  language: 'vi' | 'en';
}
export interface RemoveMobilePushCommand {
  installationSecret: string;
}
export interface MobilePushSettingsResponse {
  enabled: boolean;
  devices: Array<{ id: string; platform: string; active: boolean }>;
}
