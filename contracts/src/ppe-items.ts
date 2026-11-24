/** Technical item names; declaration alone is not camera/model capability. */
export const PPE_ITEMS = ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'] as const;
export type PpeItem = (typeof PPE_ITEMS)[number];

/**
 * Reviewed v1.3 observation families and current policy integration boundaries.
 * This catalog does not advertise a running model, measured accuracy, or safe wearing.
 * Keep PPE_ITEMS unchanged until policy validation and all consumers adopt more items.
 */
export const PPE_FAMILY_CATALOG = [
  ...PPE_ITEMS.map(
    (item) =>
      ({
        item,
        policySelectable: true,
        observationSemantics: 'PRESENT_MISSING',
        unsupportedReasonCode: null,
      }) as const,
  ),
  {
    item: 'MASK',
    policySelectable: false,
    observationSemantics: 'PRESENT_MISSING',
    unsupportedReasonCode: 'NOT_IN_POLICY_CONTRACT',
  },
  {
    item: 'FULL_BODY_HARNESS',
    policySelectable: false,
    observationSemantics: 'PRESENT_ONLY',
    unsupportedReasonCode: 'PRESENT_ONLY_SAFETY_BOUNDARY',
  },
  {
    item: 'LANYARD_HOOK',
    policySelectable: false,
    observationSemantics: 'PRESENT_ONLY',
    unsupportedReasonCode: 'PRESENT_ONLY_SAFETY_BOUNDARY',
  },
] as const;

export type PpeFamily = (typeof PPE_FAMILY_CATALOG)[number]['item'];
