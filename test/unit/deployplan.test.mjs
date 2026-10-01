import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHUNK, plan, mineSalt, create2 } from '../../scripts/deploy-lib.mjs';

test('vanity: the app gets a mined salt with leading zeros; the chunks keep theirs', () => {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><script>var WC_PROJECT="x"</script><!--config--><p>' + 'z'.repeat(CHUNK + 100) + '</p>';
  const plain = plan(html, '0x00'), vain = plan(html, '0x00', undefined, { vanity: 3 });
  assert.deepEqual(vain.chunks, plain.chunks);
  assert.ok(vain.app.startsWith('0x000'), vain.app);
  assert.equal(vain.app, create2(vain.appSalt, vain.steps.at(-1).initcode));
  assert.equal(mineSalt(vain.steps.at(-1).initcode, 3), vain.appSalt); // deterministic
  assert.ok(vain.steps.slice(0, -1).every((s) => s.salt === plain.salt));
});
