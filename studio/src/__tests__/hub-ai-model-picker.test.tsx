import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { HubAiModelSchema } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { HubAiModelPicker, modelLabel } from '@/components/hub-ai-model-picker';

const models = [
  create(HubAiModelSchema, {
    provider: 'anthropic',
    tier: 'heavy',
    gatewayModelId: 'anthropic/claude-opus-5.5',
    name: 'Claude Opus 5.5',
  }),
  create(HubAiModelSchema, {
    provider: 'google',
    tier: 'light',
    gatewayModelId: 'google/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
  }),
];

beforeAll(() => {
  // Radix Select reads pointer capture, scrolls items into view and watches sizes, which jsdom leaves out.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
});

const openPicker = () => {
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
};

describe('HubAiModelPicker', () => {
  test('labels a model by provider and tier', () => {
    expect(modelLabel({ provider: 'google', tier: 'light' })).toBe('Google · Light');
    expect(modelLabel({ provider: 'openai', tier: 'heavy' })).toBe('OpenAI · Heavy');
  });

  test('shows what an unset model means', () => {
    render(<HubAiModelPicker id="ask-ai" models={models} value="" unsetLabel="Uses default" onChange={vi.fn()} />);

    expect(screen.getByRole('combobox').textContent).toBe('Uses default');
  });

  test('lists the models by provider, Google first, and picks a gateway id or none', () => {
    const onChange = vi.fn();
    render(
      <HubAiModelPicker
        id="default-model"
        models={models}
        value="anthropic/claude-opus-5.5"
        unsetLabel="Default (Gemini 3.1 Flash Lite)"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('combobox').textContent).toBe('Anthropic · HeavyClaude Opus 5.5');

    openPicker();
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Default (Gemini 3.1 Flash Lite)',
      'Google · LightGemini 3.1 Flash Lite',
      'Anthropic · HeavyClaude Opus 5.5',
    ]);

    fireEvent.keyDown(screen.getByRole('option', { name: 'Google · Light Gemini 3.1 Flash Lite' }), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('google/gemini-3.1-flash-lite');

    openPicker();
    fireEvent.keyDown(screen.getByRole('option', { name: 'Default (Gemini 3.1 Flash Lite)' }), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
