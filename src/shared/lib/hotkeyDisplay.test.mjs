import test from 'node:test';
import assert from 'node:assert/strict';
import { getHotkeyDisplayTokens, hotkeyIdentity } from './hotkeyDisplay.ts';
for (const [raw, expected] of [['Alt+V','Alt + V'], ['Alt+Shift+V','Alt + Shift + V'], ['Alt+F','Alt + F'], ['Ctrl+Win+Space','Ctrl + Win + SPACE']]) {
  test(`plain shortcut label ${raw}`, () => {
    const tokens = getHotkeyDisplayTokens(raw, {preferMacSymbols:false});
    assert.equal(tokens.map(t=>t.label).join(' + '), expected);
    assert(tokens.every(t=>!t.isSymbol));
  });
}
for (const [a,b] of [['alt + f','Alt+KeyF'], ['Shift+Alt+V','v+OPTION+shift'], ['Control+Digit1','1+Ctrl'], ['Win+V','Super+V'], ['Command+Return','Enter+Meta']]) {
  test(`canonical alias/order: ${a}`,()=>assert.equal(hotkeyIdentity(a),hotkeyIdentity(b)));
}
test('different chords remain distinct',()=>assert.notEqual(hotkeyIdentity('Alt+V'),hotkeyIdentity('Alt+Shift+V')));
test('empty shortcut stays empty',()=>{ assert.equal(hotkeyIdentity(''), ''); assert.deepEqual(getHotkeyDisplayTokens(''), []); });
