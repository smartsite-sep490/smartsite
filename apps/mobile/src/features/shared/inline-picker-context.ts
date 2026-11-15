import { createContext } from 'react';

/** Prevent submitting an older value while an inline date draft is being edited. */
export const InlinePickerContext = createContext<(open: boolean) => void>(() => {});
