import { afterEach, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LoginScreen } from './LoginScreen';

const viewport = vi.hoisted(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 }));
vi.mock('react-native', async () => ({
  ...(await vi.importActual('react-native')),
  ImageBackground: 'ImageBackground',
  useWindowDimensions: () => viewport,
  Dimensions: { get: () => ({ ...viewport }) },
}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
let root: ReactTestRenderer;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  viewport.height = 844;
});

it('keeps the form scrollable within the keyboard viewport and lets the first submit tap reach login', async () => {
  const onLogin = vi.fn();
  await act(async () => {
    root = create(<LoginScreen onLogin={onLogin} />);
  });
  const heroHeight = root.root.findByType('ImageBackground' as React.ElementType).props.style[1]
    .height;
  viewport.height = 400;
  await act(async () => {
    root.update(<LoginScreen onLogin={onLogin} />);
  });
  const scroll = root.root.findAll((n) => String(n.type) === 'ScrollView')[0]!;
  expect(scroll.props.contentContainerStyle.minHeight ?? 0).toBeLessThanOrEqual(viewport.height);
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(scroll.props.keyboardDismissMode).toBe('on-drag');
  expect(root.root.findByType('ImageBackground' as React.ElementType).props.style[1].height).toBe(
    heroHeight,
  );
  const inputs = root.root.findAll((n) => String(n.type) === 'TextInput');
  await act(async () => {
    inputs[0]!.props.onChangeText(' worker ');
    inputs[1]!.props.onChangeText('secret');
  });
  const submit = root.root.findAll(
    (n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === 'Đăng nhập',
  )[0]!;
  expect(submit.props.disabled).toBeFalsy();
  await act(async () => submit.props.onPress());
  expect(onLogin).toHaveBeenCalledWith('worker', 'secret');
});
