import type { SmartSiteManagementClient } from '@smartsite/api-client';
import {
  PPE_FAMILY_CATALOG,
  PPE_ITEMS,
  type PpeFamily,
  type PpeItem,
} from '@smartsite/contracts/ppe-items';

export const CANONICAL_PPE_ITEMS = PPE_ITEMS;
export const CANONICAL_PPE_FAMILY_CATALOG = PPE_FAMILY_CATALOG;

export type CanonicalPpeItem = PpeItem;
export type CanonicalPpeFamily = PpeFamily;

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
