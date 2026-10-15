// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RegisterScreen } from './RegisterScreen';

afterEach(cleanup);
vi.mock('@gsap/react', () => ({ useGSAP: () => {} }));

it('explains account provisioning instead of pretending to create an account', () => {
  render(<RegisterScreen onBackToLogin={vi.fn()} onBackToSite={vi.fn()} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText(/accounts are created by authorized/)).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Sign In' })).not.toBeNull();
});
