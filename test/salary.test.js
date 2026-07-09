import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSalary } from '../src/sources/salary.js';

test('both min and max, yearly USD', () => {
  assert.equal(formatSalary(140000, 160000, 'YEAR', 'USD'), '$140K–$160K/yr');
});

test('min only', () => {
  assert.equal(formatSalary(120000, null, 'YEAR', 'USD'), '$120K+/yr');
});

test('max only', () => {
  assert.equal(formatSalary(0, 90000, 'YEAR', 'USD'), 'up to $90K/yr');
});

test('hourly formatting', () => {
  assert.equal(formatSalary(55, 70, 'HOUR', 'USD'), '$55–$70/hr');
  assert.equal(formatSalary(60, null, 'per-hour-wage', 'USD'), '$60+/hr');
});

test('none returns null', () => {
  assert.equal(formatSalary(null, null, 'YEAR', 'USD'), null);
  assert.equal(formatSalary(0, 0, 'YEAR', 'USD'), null);
});

test('non-USD currency prefixes the code', () => {
  assert.equal(formatSalary(80000, 100000, 'YEAR', 'GBP'), 'GBP 80K–GBP 100K/yr');
});

test('falsy currency defaults to $', () => {
  assert.equal(formatSalary(100000, 120000, 'YEAR', null), '$100K–$120K/yr');
});

test('Lever-style interval string is detected as hourly', () => {
  assert.equal(formatSalary(50, 65, 'per-hour-wage', 'USD'), '$50–$65/hr');
  assert.equal(formatSalary(150000, 180000, 'per-year-salary', 'USD'), '$150K–$180K/yr');
});
