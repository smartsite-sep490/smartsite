// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTIFICATION_COPY } from './IdentificationCopy';
import { IdentificationResponseForm, type NamedCandidate } from './SafetyIdentificationForms';

afterEach(cleanup);

const copy = IDENTIFICATION_COPY.vi;

const contractorA: NamedCandidate = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Nhà thầu Minh Phát',
};

const workerA: NamedCandidate = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Nguyễn Văn An',
};

const workerB: NamedCandidate = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Trần Quốc Bảo',
};

function labelPattern(label: string): RegExp {
  return new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

describe('SafetyIdentificationForms regressions', () => {
  it('blocks selected IDENTIFIED submission on candidatesLoading or candidatesError without losing draft, while keeping UNRESOLVED submittable', () => {
    const onSubmit = vi.fn();
    const view = render(
      <IdentificationResponseForm
        workers={[workerA, workerB]}
        contractors={[contractorA]}
        onSubmit={onSubmit}
        copy={copy}
      />,
    );

    fireEvent.click(
      screen.getByRole('radio', { name: labelPattern(copy.response.outcomes.IDENTIFIED.label) }),
    );
    fireEvent.change(screen.getByLabelText(copy.response.contractorLabel), {
      target: { value: contractorA.id },
    });
    fireEvent.change(screen.getByLabelText(copy.response.workerLabel), {
      target: { value: workerA.id },
    });
    fireEvent.change(screen.getByLabelText(copy.response.reasonLabel), {
      target: { value: 'Đối chiếu nhật ký phân ca tổ đội' },
    });

    view.rerender(
      <IdentificationResponseForm
        workers={[workerA, workerB]}
        contractors={[contractorA]}
        candidatesLoading
        onSubmit={onSubmit}
        copy={copy}
      />,
    );

    const submitButton = screen.getByRole('button', {
      name: copy.response.submitLabel,
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    const formElement = submitButton.closest('form');
    if (!formElement) throw new Error('Expected response form element');
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();

    view.rerender(
      <IdentificationResponseForm
        workers={[workerA, workerB]}
        contractors={[contractorA]}
        candidatesError="Không tải được danh sách ứng viên"
        onSubmit={onSubmit}
        copy={copy}
      />,
    );

    expect(submitButton.disabled).toBe(true);
    expect((screen.getByLabelText(copy.response.contractorLabel) as HTMLSelectElement).value).toBe(
      contractorA.id,
    );
    expect((screen.getByLabelText(copy.response.workerLabel) as HTMLSelectElement).value).toBe(
      workerA.id,
    );
    expect((screen.getByLabelText(copy.response.reasonLabel) as HTMLTextAreaElement).value).toBe(
      'Đối chiếu nhật ký phân ca tổ đội',
    );
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();

    const unresolvedRadio = screen.getByRole('radio', {
      name: labelPattern(copy.response.outcomes.UNRESOLVED.label),
    }) as HTMLInputElement;
    expect(unresolvedRadio.disabled).toBe(false);
    fireEvent.click(unresolvedRadio);

    expect(submitButton.disabled).toBe(false);
    fireEvent.click(submitButton);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      outcome: 'UNRESOLVED',
      workerId: null,
      contractorId: null,
      reason: 'Đối chiếu nhật ký phân ca tổ đội',
    });
  });

  it('prevents submitting IDENTIFIED when the selected Worker is unknown or removed from the scoped worker list', () => {
    const onSubmit = vi.fn();
    const view = render(
      <IdentificationResponseForm
        workers={[workerA, workerB]}
        contractors={[contractorA]}
        initialValue={{
          outcome: 'IDENTIFIED',
          workerId: '99999999-9999-4999-8999-999999999999',
          reason: 'Xác minh theo ca sáng khu B',
        }}
        onSubmit={onSubmit}
        copy={copy}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: copy.response.submitLabel }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(copy.errors.workerRequired);

    const workerSelect = screen.getByLabelText(copy.response.workerLabel) as HTMLSelectElement;
    fireEvent.change(workerSelect, { target: { value: workerA.id } });

    view.rerender(
      <IdentificationResponseForm
        workers={[workerB]}
        contractors={[contractorA]}
        onSubmit={onSubmit}
        copy={copy}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: copy.response.submitLabel }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(copy.errors.workerRequired);
    expect(workerSelect.getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(workerSelect, { target: { value: workerB.id } });
    fireEvent.click(screen.getByRole('button', { name: copy.response.submitLabel }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      outcome: 'IDENTIFIED',
      workerId: workerB.id,
      contractorId: null,
      reason: 'Xác minh theo ca sáng khu B',
    });
  });
});
