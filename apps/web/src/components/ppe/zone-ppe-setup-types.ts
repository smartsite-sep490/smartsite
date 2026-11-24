import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { PPE_ITEMS, type PpeItem } from '@smartsite/contracts/ppe-items';

export const CANONICAL_PPE_ITEMS = PPE_ITEMS;

export const UNSUPPORTED_PPE_ITEMS = ['HARNESS', 'MASK', 'HOOK'] as const;

export type CanonicalPpeItem = PpeItem;
export type UnsupportedPpeItem = (typeof UNSUPPORTED_PPE_ITEMS)[number];

export const ZONE_PAGE_SIZE = 20;

export interface ZonePpeSetupPanelProps {
  apiUrl: string;
  /** Optional pre-configured SDK client (used in testing or custom injection) */
  client?: SmartSiteManagementClient;
  token: string;
  /** Key identifying the user session / auth generation so state resets cleanly on user switch */
  sessionScope: string;
  /** Bumps when an in-place refresh replaces the active credential without exposing the token. */
  credentialId: number;
  siteId: string;
  siteName: string;
  canManageZones: boolean;
  canManageRegions: boolean;
  canReadZones?: boolean;
  section?: 'all' | 'zones' | 'regions';
  initialCameraId?: string;
  initialRegionId?: string;
  onSelectCamera?: (cameraId: string) => void;
  onOpenApply?: () => void;
  onClose: () => void;
  embedded?: boolean;
  tourUserId?: string | null;
  onDraftStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
  onUnauthorized?: () => void;
}

export interface ZonePpeSetupPanelInternalProps extends ZonePpeSetupPanelProps {
  internalNonce: number;
}
