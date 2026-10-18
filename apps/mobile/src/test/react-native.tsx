import { createElement, type PropsWithChildren } from 'react';
type Props = PropsWithChildren<Record<string, unknown>>;
function host(name: string) {
  return function Host({ children, ...props }: Props) {
    return createElement(name, props, children);
  };
}
export const View = host('View'),
  Text = host('Text'),
  TextInput = host('TextInput'),
  ScrollView = host('ScrollView'),
  Pressable = host('Pressable'),
  ActivityIndicator = host('ActivityIndicator'),
  Image = host('Image'),
  Switch = host('Switch');
export const Modal = host('Modal');
export const AppState = {
  currentState: 'active',
  addEventListener: (_event: string, _listener: (state: string) => void) => {
    void _event;
    void _listener;
    return { remove() {} };
  },
};
export const StyleSheet = { create: <T,>(styles: T) => styles };
export const Platform = { OS: 'android' };
