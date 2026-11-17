export function resolveDialogCloseTrigger(trigger?: unknown): HTMLElement | null {
  if (trigger instanceof HTMLElement) {
    return trigger;
  }
  if (
    trigger &&
    typeof trigger === 'object' &&
    'currentTarget' in trigger &&
    (trigger as { currentTarget?: unknown }).currentTarget instanceof HTMLElement
  ) {
    return (trigger as { currentTarget: HTMLElement }).currentTarget;
  }
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
