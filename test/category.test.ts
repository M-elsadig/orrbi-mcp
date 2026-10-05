import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryOf, resolveCategory } from '../src/lib/category.js';

test('English fitness words all mean gym', () => {
  for (const w of ['gym', 'Gyms', 'fitness', 'Studio', 'CrossFit', 'crossfit', 'workout', 'workouts', 'training',
    'fitness center', 'crossfit gym', 'a gym near me', 'Training session']) {
    assert.equal(resolveCategory(w), 'gym', w);
  }
});

test('Arabic fitness words all mean gym, with or without ال', () => {
  for (const w of ['جيم', 'الجيم', 'فتنس', 'رياضة', 'الرياضة', 'رياضه', 'تمارين', 'نادي', 'النادي',
    'صالة رياضية', 'نادي رياضي', 'جيم قريب مني']) {
    assert.equal(resolveCategory(w), 'gym', w);
  }
});

test('other categories pass through unchanged', () => {
  assert.equal(resolveCategory('barber'), 'barber');
  assert.equal(resolveCategory('salon'), 'salon');
});

test('a business name is not mistaken for a category', () => {
  assert.equal(categoryOf('Aflete'), null);
  assert.equal(categoryOf('Falcon Gym'), null);
  assert.equal(categoryOf('أفليت'), null);
  assert.equal(categoryOf('near me'), null);
});
