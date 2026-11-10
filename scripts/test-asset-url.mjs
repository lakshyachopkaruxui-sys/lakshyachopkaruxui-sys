import test from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl } from '../src/utils/assetUrl.ts';

test('public models and audio resolve below a project Pages path', () => {
  assert.equal(assetUrl('/models/fir.glb', '/tear/'), '/tear/models/fir.glb');
  assert.equal(assetUrl('/audio/voice.wav?v=2#cue', '/tear'), '/tear/audio/voice.wav?v=2#cue');
  assert.equal(assetUrl('/models/fir.glb', '/models/'), '/models/models/fir.glb');
});
test('root-hosted assets and external loader URLs retain their meaning', () => {
  assert.equal(assetUrl('/models/fir.glb'), '/models/fir.glb');
  for (const url of ['textures/leaf.png', 'https://example.com/a.glb', '//example.com/a.glb', 'blob:local', 'data:image/png;base64,abc']) {
    assert.equal(assetUrl(url, '/tear/'), url);
  }
});
