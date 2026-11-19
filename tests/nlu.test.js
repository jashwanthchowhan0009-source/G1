import test from 'node:test';
import assert from 'node:assert/strict';
test('phones mishearing "G1" as Jeevan or Jivan still reach G1', async () => {
  const { hasWake, normalizeWake, stripWake } = await import('../public/js/core/nlu.js');
  assert.equal(normalizeWake('Jeevan call Papa'), 'G1, call Papa');
  assert.equal(normalizeWake('hey jivan what time is it'), 'hey G1, what time is it');
  assert.equal(stripWake('जीवन मौसम कैसा है'), 'मौसम कैसा है');
  assert.ok(hasWake('ok gee one remind me'));
  assert.ok(!hasWake('my jeevan is good'));
  assert.equal(normalizeWake('call papa'), 'call papa');
});
