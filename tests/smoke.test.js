import { makeInitialState } from '../src/lib/checkers.js';

test('initial state turn is red', () => {
  expect(makeInitialState().turn).toBe('red');
});
