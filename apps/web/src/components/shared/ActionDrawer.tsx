import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { IconX } from '../icons';

export interface ActionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  badge?: string;
  badgeType?: 'error' | 'warning' | 'info';
  children: React.ReactNode;
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

function resolveExternalOpener(drawerEl: HTMLElement): HTMLElement | null {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    active.isConnected &&
    !drawerEl.contains(active)
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
      !drawerEl.contains(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

function acquireDrawerSlot(el: HTMLElement): {
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
  drawerEl: HTMLElement,
  stack: readonly HTMLElement[],
): boolean {
  if (candidate === drawerEl) return false;
  if (stack.includes(candidate)) {
    return stack.lastIndexOf(candidate) > stack.lastIndexOf(drawerEl);
  }
  return (
    drawerEl.contains(candidate) ||
    (!candidate.contains(drawerEl) &&
      Boolean(drawerEl.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING))
  );
}

function isExternalPortalOrHigherModal(
  target: Node,
  drawerEl: HTMLElement,
  stack: readonly HTMLElement[],
): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-radix-popper-content-wrapper], [data-radix-portal]')) {
    return true;
  }
  const enclosingModal = target.closest<HTMLElement>(ACTIVE_MODAL_SELECTOR);
  return Boolean(enclosingModal && isHigherModalElement(enclosingModal, drawerEl, stack));
}

function hasHigherExternalModal(drawerEl: HTMLElement, stack: readonly HTMLElement[]): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(ACTIVE_MODAL_SELECTOR)).some(
    (candidate) => !stack.includes(candidate) && isHigherModalElement(candidate, drawerEl, stack),
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

export function ActionDrawer({
  isOpen,
  onClose,
  title,
  description,
  badge,
  badgeType = 'info',
  children,
}: ActionDrawerProps) {
  useTranslation();
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const wasOpenRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // We use a slight delay for the mount/unmount logic to allow CSS transitions to play
  const [shouldRender, setShouldRender] = useState(isOpen);

  if (isOpen && !shouldRender) {
    setShouldRender(true);
  }

  useEffect(() => {
    if (!isOpen && shouldRender) {
      const timer = setTimeout(() => setShouldRender(false), 500); // match transition duration
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  useLayoutEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return;
    if (!isOpen) {
      panelEl.inert = true;
      panelEl.setAttribute('inert', '');
    } else {
      panelEl.inert = false;
      panelEl.removeAttribute('inert');
    }
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      openerRef.current = null;
      return;
    }
    const panelEl = panelRef.current;
    if (!panelEl) return;

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      openerRef.current = resolveExternalOpener(panelEl);
    }
    const slot = acquireDrawerSlot(panelEl);

    if (
      slot.isTop() &&
      (!panelEl.contains(document.activeElement) || document.activeElement === panelEl)
    ) {
      const bodyEl = panelEl.querySelector<HTMLElement>('[data-drawer-body]');
      const target =
        (bodyEl && getFocusableElements(bodyEl)[0]) || getFocusableElements(panelEl)[0] || panelEl;
      target.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !slot.isTop() || hasHigherExternalModal(panelEl, slot.getStack())) {
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
        const controls = getFocusableElements(panelEl);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) {
          e.preventDefault();
          panelEl.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === first || !panelEl.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || !panelEl.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (!slot.isTop() || !(e.target instanceof Node)) return;
      if (
        panelEl.contains(e.target) ||
        isExternalPortalOrHigherModal(e.target, panelEl, slot.getStack())
      ) {
        return;
      }
      const fallback = getFocusableElements(panelEl)[0] || panelEl;
      fallback.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      const nextTopModal = slot.release();
      restoreFocusAfterClose(openerRef.current, panelEl, nextTopModal);
    };
  }, [isOpen]);

  if (!shouldRender) return null;

  const badgeColors = {
    error: 'bg-[#FDEBEC] text-[#9F2F2D]',
    warning: 'bg-[#FBF3DB] text-[#956400]',
    info: 'bg-[#F7F6F3] text-[#6B6B6B]',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden pointer-events-none flex justify-end">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-black/30 transition-opacity duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={isOpen ? onClose : undefined}
      />

      {/* Drawer Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={isOpen ? 'true' : undefined}
        aria-hidden={!isOpen ? 'true' : undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        inert={!isOpen || undefined}
        tabIndex={-1}
        className={`relative w-full max-w-md h-full bg-[#FBFBFA] border-l border-[#EAEAEA] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none ${
          isOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
        }`}
      >
        {/* Inner Core */}
        <div className="bg-white h-full border border-[#EAEAEA] rounded-lg m-1.5 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-[#EAEAEA] flex items-center justify-between bg-white z-10">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {badge && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider ${badgeColors[badgeType]}`}
                  >
                    {badge}
                  </span>
                )}
                <h3 id={titleId} className="font-bold text-[#111111] tracking-tight">
                  {title}
                </h3>
              </div>
              {description && (
                <p id={descriptionId} className="text-xs text-[#6B6B6B] mt-1 leading-normal">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tr('common.close_drawer')}
              className="p-1.5 rounded-md text-[#6B6B6B] hover:text-[#2F3437] hover:bg-[#F7F6F3] transition-colors active:scale-95 cursor-pointer"
            >
              <IconX className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div data-drawer-body className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
