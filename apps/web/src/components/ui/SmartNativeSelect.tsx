import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SmartSelect, type SmartSelectOption } from './SmartFormControls';

function optionText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return React.isValidElement<{ children?: React.ReactNode }>(child)
        ? optionText(child.props.children)
        : '';
    })
    .join('');
}

function selectOptions(children: React.ReactNode, groupDisabled = false): SmartSelectOption[] {
  const options: SmartSelectOption[] = [];
  React.Children.forEach(children, (child) => {
    if (
      !React.isValidElement<{
        children?: React.ReactNode;
        value?: string | number;
        label?: string;
        disabled?: boolean;
      }>(child)
    )
      return;
    if (child.type === 'option') {
      const text = optionText(child.props.children);
      options.push({
        value: String(child.props.value ?? text),
        label: child.props.label ?? text,
        disabled: groupDisabled || child.props.disabled,
      });
    } else {
      options.push(...selectOptions(child.props.children, groupDisabled || child.props.disabled));
    }
  });
  return options;
}

/** Keep native form semantics, events and refs while sharing SmartSelect's visible menu. */
export const SmartNativeSelect = React.forwardRef<
  HTMLSelectElement,
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'>
>(({ children, className = '', style, value, defaultValue, disabled, onChange, ...props }, ref) => {
  const nativeRef = useRef<HTMLSelectElement>(null);
  const [localValue, setLocalValue] = useState(defaultValue);
  const options = selectOptions(children);
  const requestedValue = value ?? localValue;
  const selectedValue = options.some((option) => option.value === String(requestedValue))
    ? String(requestedValue)
    : (options.find((option) => !option.disabled)?.value ?? '');

  // The browser preserves uncontrolled selections across async option updates.
  // Read that committed selection before painting the shared visual control.
  useLayoutEffect(() => {
    const selected = nativeRef.current?.value;
    if (value === undefined && selected !== undefined && selected !== localValue) {
      setLocalValue(selected);
    }
  }, [children, value, localValue]);

  useEffect(() => {
    const form = nativeRef.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => setLocalValue(defaultValue);
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [defaultValue, value]);

  return (
    <SmartSelect
      options={options}
      value={selectedValue}
      disabled={disabled}
      size="sm"
      className={className}
      nativeControlRef={nativeRef}
      onChange={(nextValue) => {
        const select = nativeRef.current;
        if (!select || select.matches(':disabled')) return;
        select.value = nextValue;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }}
      nativeControl={
        <select
          {...props}
          ref={(element) => {
            nativeRef.current = element;
            if (typeof ref === 'function') ref(element);
            else if (ref) ref.current = element;
          }}
          value={value}
          defaultValue={defaultValue}
          disabled={disabled}
          className="sr-only"
          style={style}
          onChange={(event) => {
            if (value === undefined) setLocalValue(event.target.value);
            onChange?.(event);
          }}
        >
          {children}
        </select>
      }
    />
  );
});
SmartNativeSelect.displayName = 'SmartNativeSelect';
