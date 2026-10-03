import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQatarPhone } from '../src/lib/phone.js';

const accepted: [string, string][] = [
  ['55123456', '+97455123456'],
  ['974 5512-3456', '+97455123456'],
  ['97455123456', '+97455123456'],
  ['+97455123456', '+97455123456'],
  ['+974 5512 3456', '+97455123456'],
  ['974-55-12-34-56', '+97455123456'],
  ['0097455123456', '+97455123456'],
  ['00974 5512 3456', '+97455123456'],
  ['00974-5512-3456', '+97455123456'],
  ['97412345', '+97497412345']          // 8 local digits that happen to start with 974
];

const rejected = [
  '5512345',          // 7 digits
  '+9745512345',      // 7 digits after +974
  '+974551234567',    // 9 digits after +974
  '009745512345',     // 7 digits after 00974
  '+971501234567',    // UAE
  '+00974 55123456',
  '0974 55123456',
  '55abc456',
  '(974)55123456',
  ''
];

for (const [input, want] of accepted) {
  test(`accepts ${JSON.stringify(input)}`, () => assert.equal(normalizeQatarPhone(input), want));
}

for (const input of rejected) {
  test(`rejects ${JSON.stringify(input)}`, () => assert.equal(normalizeQatarPhone(input), null));
}
