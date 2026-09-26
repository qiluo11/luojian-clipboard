import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideSearchHotkeyAction } from './searchHotkeyToggle.ts';

const base = { wasHidden: false, inPlace: false, overlayOpen: false, panelOpen: false };

describe('Alt+F search toggle', () => {
    it('opens a closed search bar and closes an open one', () => {
        assert.equal(decideSearchHotkeyAction(base), 'open');
        assert.equal(decideSearchHotkeyAction({ ...base, panelOpen: true }), 'close');
    });
    it('always opens when summoning a hidden window', () => {
        assert.equal(decideSearchHotkeyAction({ ...base, wasHidden: true, panelOpen: true }), 'open');
    });
    it('opens instead of closing when an overlay covers the list', () => {
        assert.equal(decideSearchHotkeyAction({ ...base, overlayOpen: true, panelOpen: true }), 'open');
    });
    it('focuses the inline search in favorites / recent views', () => {
        assert.equal(decideSearchHotkeyAction({ ...base, inPlace: true, panelOpen: true }), 'focus-inplace');
        assert.equal(decideSearchHotkeyAction({ ...base, inPlace: true, wasHidden: true }), 'focus-inplace');
    });
});
