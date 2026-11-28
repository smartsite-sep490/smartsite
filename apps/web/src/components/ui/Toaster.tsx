import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Toast } from '@base-ui/react/toast';
import { IconAlertCircle, IconCheck, IconX } from '../icons';
import { getToastHost, toast, subscribeToastHost } from './toast-manager';

export function Toaster() {
  return (
    <Toast.Provider toastManager={toast} limit={3}>
      <ToastList />
    </Toast.Provider>
  );
}

function ToastList() {
  const { t } = useTranslation();
  const { toasts } = Toast.useToastManager();
  const container = useSyncExternalStore(subscribeToastHost, getToastHost, () => undefined);
  return (
    <Toast.Portal container={container}>
      <Toast.Viewport className="app-toast-viewport fixed bottom-5 right-5 z-50 flex w-[calc(100vw-2.5rem)] max-w-sm flex-col gap-3 outline-none">
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className="app-toast rounded-xl border p-4 shadow-lg data-[limited]:hidden"
          >
            <Toast.Content className="flex items-start gap-3">
              {toast.type === 'error' ? (
                <IconAlertCircle className="size-5 shrink-0 text-[var(--semantic-red-text)]" />
              ) : toast.type === 'success' ? (
                <IconCheck className="size-5 shrink-0 text-[var(--semantic-green-text)]" />
              ) : null}
              <div className="min-w-0 flex-1">
                <Toast.Title className="text-sm font-semibold" />
                <Toast.Description className="mt-1 text-sm" />
              </div>
              <Toast.Close
                aria-label={t('common.close')}
                className="rounded p-1 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <IconX className="size-4" />
              </Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
