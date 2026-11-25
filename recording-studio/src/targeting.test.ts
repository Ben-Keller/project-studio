import { describe, expect, it } from 'vitest';
import { getInputText } from './targeting';

describe('walkthrough targeting', () => {
  it('only treats text-like inputs as typed text', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = 'on';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.value = 'on';

    const text = document.createElement('input');
    text.type = 'text';
    text.value = 'show projects in RBAP';

    const textarea = document.createElement('textarea');
    textarea.value = 'walkthrough notes';

    expect(getInputText(checkbox)).toBeUndefined();
    expect(getInputText(radio)).toBeUndefined();
    expect(getInputText(text)).toBe('show projects in RBAP');
    expect(getInputText(textarea)).toBe('walkthrough notes');
  });
});
