import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../i18n/ppe-locale';
import { IconX } from '../icons';

export interface PpeDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
}

const focusSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

// Dialogs can overlap during a child editor or route transition. Page isolation
// belongs to all open dialogs; keyboard/focus handling belongs only to the top one.
const dialogStack: HTMLElement[] = [];
const backgroundLocks = new Map<HTMLElement, {
  count: number;
  inert: string | null;
  hidden: string | null;
}>();
let originalBodyOverflow: string | null = null;

function isolatePage(portal: HTMLElement): () => void {
  if (dialogStack.length === 0) originalBodyOverflow = document.body.style.overflow;
  dialogStack.push(portal);
  const background = Array.from(document.body.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement && element !== portal,
  );
  for (const element of background) {
    const lock = backgroundLocks.get(element);
    if (lock) lock.count += 1;
    else backgroundLocks.set(element, {
      count: 1, inert: element.getAttribute('inert'), hidden: element.getAttribute('aria-hidden'),
    });
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = 'hidden';
  return () => {
    const index = dialogStack.indexOf(portal);
    if (index !== -1) dialogStack.splice(index, 1);
    for (const element of background) {
      const lock = backgroundLocks.get(element);
      if (!lock || --lock.count > 0) continue;
      if (lock.inert === null) element.removeAttribute('inert'); else element.setAttribute('inert', lock.inert);
      if (lock.hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', lock.hidden);
      backgroundLocks.delete(element);
    }
    if (dialogStack.length === 0) {
      document.body.style.overflow = originalBodyOverflow ?? '';
      originalBodyOverflow = null;
    }
  };
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusSelector)).filter(
    (element) => {
      if (element.matches(':disabled') || element.closest('[hidden], [aria-hidden="true"], [inert]') ||
        (element instanceof HTMLInputElement && element.type === 'hidden')) return false;
      for (let ancestor: HTMLElement | null = element; ancestor && ancestor !== container; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    },
  );
}

/** Safety-owned modal; other teams' shared dialog implementations stay untouched. */
export function PpeDialog({ open, onClose, title, description, children, wide = false, closeDisabled = false }: PpeDialogProps) {
  const { t } = useLocale();
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [portal] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'));

  useEffect(() => { closeRef.current = () => { if (!closeDisabled) onClose(); }; }, [onClose, closeDisabled]);

  useEffect(() => {
    if (!open || !portal) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.append(portal);
    const releasePage = isolatePage(portal);
    const isTopDialog = () => dialogStack.at(-1) === portal;

    const initialFocus = () => {
      const dialog = dialogRef.current;
      if (!dialog || !isTopDialog()) return;
      const content = dialog.querySelector<HTMLElement>('[data-ppe-dialog-content]');
      (content && focusableElements(content)[0] || focusableElements(dialog)[0] || dialog).focus();
    };
    initialFocus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopDialog()) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const controls = focusableElements(dialog);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTopDialog() && event.target instanceof Node && !dialogRef.current?.contains(event.target)) initialFocus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocus);
      releasePage();
      portal.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open, portal]);

  if (!open || !portal) return null;
  return createPortal(
    <div data-testid="ppe-dialog-backdrop" className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 p-3 sm:p-6" onClick={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} tabIndex={-1}
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full min-w-0 flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-[0_16px_64px_rgba(7,26,43,0.14)] sm:rounded-[2rem] ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-8 sm:py-6">
          <div className="min-w-0"><h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight text-[#111111]">{title}</h2>
            {description && <p id={`${id}-description`} className="mt-1.5 text-sm leading-relaxed text-[#6B6B6B]">{description}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={closeDisabled} aria-label={t('dialog.closeAria')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111] disabled:opacity-50">
            <IconX className="h-5 w-5" />
          </button>
        </header>
        <div data-ppe-dialog-content className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-5 sm:p-8">{children}</div>
      </div>
    </div>, portal,
  );
}
