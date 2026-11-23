import { afterEach, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LoginScreen } from './LoginScreen';
import { Platform } from 'react-native';

const viewport = vi.hoisted(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 }));
const keyboard = vi.hoisted(() => ({
  listeners: new Map<string, Set<() => void>>(),
  scrollTo: vi.fn(),
  focusPassword: vi.fn(),
}));
vi.mock('react-native', async () => ({
  ...(await vi.importActual('react-native')),
  ImageBackground: 'ImageBackground',
  useWindowDimensions: () => viewport,
  Dimensions: { get: () => ({ ...viewport }) },
  Keyboard: {
    addListener: (event: string, listener: () => void) => {
      if (!keyboard.listeners.has(event)) keyboard.listeners.set(event, new Set());
      keyboard.listeners.get(event)!.add(listener);
      return { remove: () => keyboard.listeners.get(event)?.delete(listener) };
    },
  },
}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
let root: ReactTestRenderer;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  viewport.height = 844;
  keyboard.listeners.clear();
  keyboard.scrollTo.mockClear();
  keyboard.focusPassword.mockClear();
  Object.assign(Platform, { OS: 'android' });
});

it.each(['ios', 'android'])(
  'moves the focused password above the %s keyboard after resizing and restores the hero on dismissal',
  async (platform) => {
    Object.assign(Platform, { OS: platform });
    const onLogin = vi.fn();
    await act(async () => {
      root = create(<LoginScreen onLogin={onLogin} />, {
        createNodeMock: (element) =>
          element.type === 'ScrollView'
            ? { scrollTo: keyboard.scrollTo }
            : element.type === 'TextInput'
              ? { focus: keyboard.focusPassword }
              : null,
      });
    });
    const hero = () =>
      root.root.findByType('ImageBackground' as React.ElementType).props.style[1].height;
    const originalHeight = hero();
    const sheet = root.root.findAll((n) => String(n.type) === 'View' && n.props.onLayout)[0]!;
    const passwordRow = root.root
      .findAll((n) => String(n.type) === 'View' && n.props.onLayout)
      .at(-1)!;
    const inputs = root.root.findAll((n) => String(n.type) === 'TextInput');
    await act(async () => {
      sheet.props.onLayout({ nativeEvent: { layout: { y: 340 } } });
      passwordRow.props.onLayout({ nativeEvent: { layout: { y: 190 } } });
      inputs[1]!.props.onFocus();
      keyboard.listeners.get('keyboardDidShow')?.forEach((listener) => listener());
    });
    expect(hero()).toBeLessThan(originalHeight);
    expect(keyboard.scrollTo).toHaveBeenCalledWith({ y: 514, animated: true });
    const scroll = root.root.findAll((n) => String(n.type) === 'ScrollView')[0]!;
    keyboard.scrollTo.mockClear();
    await act(async () => scroll.props.onLayout());
    expect(keyboard.scrollTo).toHaveBeenCalledWith({ y: 514, animated: true });
    await act(async () => {
      inputs[0]!.props.onChangeText(' worker ');
      inputs[1]!.props.onChangeText('Password1!');
    });
    await act(async () => inputs[1]!.props.onSubmitEditing());
    expect(onLogin).toHaveBeenCalledWith('worker', 'Password1!');
    await act(async () =>
      keyboard.listeners.get('keyboardDidHide')?.forEach((listener) => listener()),
    );
    expect(hero()).toBe(originalHeight);
    await act(async () => root.unmount());
    expect([...keyboard.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  },
);

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
