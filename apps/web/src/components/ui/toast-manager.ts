import { Toast } from '@base-ui/react/toast';

export const toast = Toast.createToastManager();

let host: HTMLElement | undefined;
const listeners = new Set<() => void>();
export const subscribeToastHost = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getToastHost = () => host;
export function attachToastHost(element: HTMLElement) {
  const previous = host;
  host = element;
  listeners.forEach((listener) => listener());
  return () => {
    host = previous;
    listeners.forEach((listener) => listener());
  };
}
