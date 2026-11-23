import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useId, useRef } from 'react';
import { IconX } from '../icons';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '4xl';
}

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
const ACTIVE_MODAL_SELECTOR =
  '[role="dialog"][aria-modal="true"]:not([inert]), dialog[open]:not([inert])';

const MODAL_STACK_KEY = Symbol.for('smartsite.modalStack');
const MODAL_OVERFLOW_KEY = Symbol.for('smartsite.modalSavedOverflow');
const MODAL_FOCUS_HISTORY_KEY = Symbol.for('smartsite.modalFocusHistory');
const MODAL_TRACKED_DOCS_KEY = Symbol.for('smartsite.modalTrackedDocs');

type ModalGlobal = typeof globalThis & {
  [MODAL_STACK_KEY]?: HTMLElement[];
  [MODAL_OVERFLOW_KEY]?: string | null;
  [MODAL_FOCUS_HISTORY_KEY]?: HTMLElement[];
  [MODAL_TRACKED_DOCS_KEY]?: WeakSet<Document>;
};

function ensureFocusHistory(doc: Document): void {
  const g = globalThis as ModalGlobal;
  const tracked = (g[MODAL_TRACKED_DOCS_KEY] ??= new WeakSet<Document>());
  if (tracked.has(doc)) return;
  tracked.add(doc);
  doc.addEventListener(
    'focusin',
    (ev) => {
      if (!(ev.target instanceof HTMLElement)) return;
      const list = (g[MODAL_FOCUS_HISTORY_KEY] ??= []).filter(
        (item) => item.isConnected && item !== ev.target,
      );
      list.push(ev.target);
      if (list.length > 20) list.splice(0, list.length - 20);
      g[MODAL_FOCUS_HISTORY_KEY] = list;
    },
    true,
  );
}

if (typeof document !== 'undefined') {
  ensureFocusHistory(document);
}

function resolveExternalOpener(modalEl: HTMLElement): HTMLElement | null {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    active.isConnected &&
    !modalEl.contains(active)
  ) {
    return active;
  }
  const g = globalThis as ModalGlobal;
  const history = g[MODAL_FOCUS_HISTORY_KEY] ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const candidate = history[i];
    if (
      candidate &&
      candidate !== document.body &&
      candidate.isConnected &&
      !modalEl.contains(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

function acquireModalSlot(el: HTMLElement): {
  isTop: () => boolean;
  getStack: () => readonly HTMLElement[];
  release: () => HTMLElement | undefined;
} {
  ensureFocusHistory(el.ownerDocument);
  const g = globalThis as ModalGlobal;
  const stack = (g[MODAL_STACK_KEY] ??= []);
  if (stack.length === 0) {
    g[MODAL_OVERFLOW_KEY] = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  const existingIdx = stack.indexOf(el);
  if (existingIdx !== -1) stack.splice(existingIdx, 1);

  const descendantIdx = stack.findIndex((item) => el.contains(item));
  if (descendantIdx !== -1) {
    stack.splice(descendantIdx, 0, el);
  } else {
    stack.push(el);
  }

  return {
    isTop: () => stack.at(-1) === el,
    getStack: () => stack,
    release: () => {
      const idx = stack.lastIndexOf(el);
      if (idx !== -1) stack.splice(idx, 1);
      if (stack.length === 0) {
        document.body.style.overflow = g[MODAL_OVERFLOW_KEY] ?? '';
        g[MODAL_OVERFLOW_KEY] = null;
      }
      for (let i = stack.length - 1; i >= 0; i--) {
        const candidate = stack[i];
        if (candidate && candidate.isConnected && !candidate.hasAttribute('inert')) {
          return candidate;
        }
      }
      return undefined;
    },
  };
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const modalRoot = container.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (
      el.matches(':disabled') ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.closest('[hidden], [inert], [aria-hidden="true"]')
    ) {
      return false;
    }
    if (modalRoot && el.closest('[role="dialog"][aria-modal="true"]') !== modalRoot) {
      return false;
    }
    for (let node: HTMLElement | null = el; node && node !== container; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  });
}

function isHigherModalElement(
  candidate: HTMLElement,
  modalEl: HTMLElement,
  stack: readonly HTMLElement[],
): boolean {
  if (candidate === modalEl) return false;
  if (stack.includes(candidate)) {
    return stack.lastIndexOf(candidate) > stack.lastIndexOf(modalEl);
  }
  return (
    modalEl.contains(candidate) ||
    (!candidate.contains(modalEl) &&
      Boolean(modalEl.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING))
  );
}

function isExternalPortalOrHigherModal(
  target: Node,
  modalEl: HTMLElement,
  stack: readonly HTMLElement[],
): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-radix-popper-content-wrapper], [data-radix-portal]')) {
    return true;
  }
  const enclosingModal = target.closest<HTMLElement>(ACTIVE_MODAL_SELECTOR);
  return Boolean(enclosingModal && isHigherModalElement(enclosingModal, modalEl, stack));
}

function hasHigherExternalModal(modalEl: HTMLElement, stack: readonly HTMLElement[]): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(ACTIVE_MODAL_SELECTOR)).some(
    (candidate) => !stack.includes(candidate) && isHigherModalElement(candidate, modalEl, stack),
  );
}

function isRestorableOpener(
  target: HTMLElement | null,
  closingEl: HTMLElement,
): target is HTMLElement {
  if (!target || !target.isConnected || closingEl.contains(target)) return false;
  if (
    target.matches(':disabled') ||
    target.getAttribute('aria-disabled') === 'true' ||
    target.closest('[inert], [aria-hidden="true"], [hidden]')
  ) {
    return false;
  }
  const style = window.getComputedStyle(target);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function restoreFocusAfterClose(
  opener: HTMLElement | null,
  closingEl: HTMLElement,
  nextTopModal: HTMLElement | undefined,
): void {
  if (nextTopModal) {
    if (isRestorableOpener(opener, closingEl) && nextTopModal.contains(opener)) {
      opener.focus();
    } else if (
      !nextTopModal.contains(document.activeElement) ||
      closingEl.contains(document.activeElement)
    ) {
      (getFocusableElements(nextTopModal)[0] || nextTopModal).focus();
    }
    return;
  }
  if (isRestorableOpener(opener, closingEl)) {
    opener.focus();
  }
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  maxWidth = 'md',
}: DialogProps) {
  useTranslation();
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const wasOpenRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      openerRef.current = null;
      return;
    }
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      openerRef.current = resolveExternalOpener(dialogEl);
    }
    const slot = acquireModalSlot(dialogEl);

    const focusInitial = () => {
      if (!slot.isTop()) return;
      if (dialogEl.contains(document.activeElement) && document.activeElement !== dialogEl) {
        return;
      }
      const bodyEl = dialogEl.querySelector<HTMLElement>('[data-dialog-body]');
      const target =
        (bodyEl && getFocusableElements(bodyEl)[0]) ||
        getFocusableElements(dialogEl)[0] ||
        dialogEl;
      target.focus();
    };
    focusInitial();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        !slot.isTop() ||
        hasHigherExternalModal(dialogEl, slot.getStack())
      ) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab') {
        if (
          document.activeElement instanceof Element &&
          document.activeElement.closest('[data-radix-popper-content-wrapper], [data-radix-portal]')
        ) {
          return;
        }
        const controls = getFocusableElements(dialogEl);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) {
          e.preventDefault();
          dialogEl.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === first || !dialogEl.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || !dialogEl.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (!slot.isTop() || !(e.target instanceof Node)) return;
      if (
        dialogEl.contains(e.target) ||
        isExternalPortalOrHigherModal(e.target, dialogEl, slot.getStack())
      ) {
        return;
      }
      const fallback = getFocusableElements(dialogEl)[0] || dialogEl;
      fallback.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      const nextTopModal = slot.release();
      restoreFocusAfterClose(openerRef.current, dialogEl, nextTopModal);
    };
  }, [open]);

  if (!open) return null;

  const maxWidthStyles = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '4xl': 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative z-10 max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xl w-full ${maxWidthStyles[maxWidth]} p-6 space-y-4 animate-in zoom-in-95 duration-200 outline-none`}
      >
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="w-8 h-8 rounded-xl bg-[#071A2B] text-white flex items-center justify-center shrink-0">
                {icon}
              </div>
            )}
            <div>
              <h3 id={titleId} className="text-sm font-bold text-slate-900 leading-tight">
                {title}
              </h3>
              {description && (
                <p id={descriptionId} className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                  {description}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
            aria-label={tr('common.close_dialog')}
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>
        <div data-dialog-body className="contents">
          {children}
        </div>
      </div>
    </div>
  );
}
