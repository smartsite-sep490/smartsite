/** Technical item names; declaration alone is not camera/model capability. */
export const PPE_ITEMS = ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'] as const;
export type PpeItem = (typeof PPE_ITEMS)[number];
