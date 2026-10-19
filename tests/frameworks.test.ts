import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { frameworkLabel, frameworksIn, isFrameworkId, pickFramework } from '../src/features/section/frameworks.ts';
import { DEFAULT_PREFS } from '../src/state/prefs.ts';

const html = '<p>shared</p><section class="fw" data-fw="vue">v</section><section class="fw" data-fw="react">r</section>';

describe('framework variants', () => {
  it('lists the frameworks an answer has, in display order', () => {
    assert.deepEqual(frameworksIn(html), ['react', 'vue']);
    assert.deepEqual(frameworksIn('<p>plain</p>'), []);
  });

  it('uses the reader choice when available, else React, else the first one', () => {
    assert.equal(pickFramework(['react', 'angular', 'vue'], 'angular'), 'angular');
    assert.equal(pickFramework(['react', 'vue'], 'angular'), 'react');
    assert.equal(pickFramework(['angular', 'vue'], 'react'), 'angular');
    assert.equal(pickFramework([], 'react'), null);
  });

  it('validates ids and has React as the default preference', () => {
    assert.ok(isFrameworkId('vue'));
    assert.ok(!isFrameworkId('svelte'));
    assert.equal(frameworkLabel('angular'), 'Angular');
    assert.equal(DEFAULT_PREFS.framework, 'react');
  });
});
