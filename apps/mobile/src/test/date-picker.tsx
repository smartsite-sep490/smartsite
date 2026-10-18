import { createElement } from 'react';
export default function Picker(props: Record<string, unknown>) {
  return createElement('DateTimePicker', props);
}
