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

interface AnimationConfig {
  toValue?: number;
}
interface AnimationResult {
  finished: boolean;
}
type AnimationCallback = (result: AnimationResult) => void;
interface AnimationHandle {
  start: (cb?: AnimationCallback) => void;
}

class AnimatedValue {
  _val: number;
  constructor(v: number) {
    this._val = v;
  }
  setValue(v: number) {
    this._val = v;
  }
  interpolate() {
    return this;
  }
}

export const Animated = {
  Value: AnimatedValue,
  timing: (val: AnimatedValue | undefined, config?: AnimationConfig): AnimationHandle => ({
    start: (cb?: AnimationCallback) => {
      if (config?.toValue !== undefined) {
        val?.setValue(config.toValue);
      }
      cb?.({ finished: true });
    },
  }),
  spring: (val: AnimatedValue | undefined, config?: AnimationConfig): AnimationHandle => ({
    start: (cb?: AnimationCallback) => {
      if (config?.toValue !== undefined) {
        val?.setValue(config.toValue);
      }
      cb?.({ finished: true });
    },
  }),
  parallel: (anims: AnimationHandle[]): AnimationHandle => ({
    start: (cb?: AnimationCallback) => {
      anims.forEach((a) => a?.start?.());
      cb?.({ finished: true });
    },
  }),
  sequence: (anims: AnimationHandle[]): AnimationHandle => ({
    start: (cb?: AnimationCallback) => {
      anims.forEach((a) => a?.start?.());
      cb?.({ finished: true });
    },
  }),
  loop: (anim: AnimationHandle): AnimationHandle => ({
    start: (cb?: AnimationCallback) => {
      anim?.start?.();
      cb?.({ finished: true });
    },
  }),
  View: host('Animated.View'),
  Text: host('Animated.Text'),
};

export const PanResponder = {
  create: <T,>(config: T) => ({
    panHandlers: config,
  }),
};
