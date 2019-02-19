import test from 'tape';
import { SES } from '../src/index';

test('SESRealm global is frozen', t => {
  const s = SES.makeSESRootRealm();
  t.throws(() => s.evaluate('this.a = 10;'), TypeError);
  t.equal(s.evaluate('this.a'), undefined);
  t.end();
});

test('SESRealm named intrinsics are frozen', t => {
  const s = SES.makeSESRootRealm();
  t.throws(() => s.evaluate('Object.a = 10;'), TypeError);
  t.throws(() => s.evaluate('Number.a = 10;'), TypeError);
  t.throws(() => s.evaluate('Date.a = 10;'), TypeError);
  t.throws(() => s.evaluate('Array.a = 10;'), TypeError);
  t.throws(() => s.evaluate('Array.push = 10;'), TypeError);
  t.throws(() => s.evaluate('WeakSet.a = 10;'), TypeError);
  t.end();
});

test('SESRealm anonymous intrinsics are frozen', t => {
  const s = SES.makeSESRootRealm();
  // these two will be frozen once #41 is fixed
  t.throws(
    () => s.evaluate('(async function() {}).constructor.a = 10;'),
    TypeError,
  );
  t.throws(
    () => s.evaluate('(async function*() {}).constructor.a = 10;'),
    TypeError,
  );
  t.throws(() => s.evaluate('(function*() {}).constructor.a = 10;'), TypeError);
  t.throws(
    () => s.evaluate('[][Symbol.iterator]().constructor.a = 10;'),
    TypeError,
  );
  t.throws(
    () => s.evaluate('new Map()[Symbol.iterator]().constructor.a = 10;'),
    TypeError,
  );
  t.throws(
    () => s.evaluate('new Set()[Symbol.iterator]().constructor.a = 10;'),
    TypeError,
  );
  t.throws(
    () => s.evaluate('new WeakMap()[Symbol.iterator]().constructor.a = 10;'),
    TypeError,
  );
  t.throws(
    () => s.evaluate('new WeakSet()[Symbol.iterator]().constructor.a = 10;'),
    TypeError,
  );
  t.end();
});

test.skip('prototypes are checked correctly', t => {
  const s = SES.makeSESRootRealm({consoleMode: 'allow', errorStackMode: 'allow'});
  function makeObjects() {
    const a = {a: 1};
    const b = {b: 1, __proto__: a};
    const c = {c: 1, __proto__: b};
    return { a, b, c };
  }
  // TODO: one failure mode (of a harden() that 
  function doHarden(b, c) {
    const harden = require('@agoric/harden');
    try {
      harden(b);
      // this fails because 'a' is not yet frozen, but it might still put 'b'
      // into the frozenSet
    } catch (e) {
    }
    // this is supposed to fail. If 'b' was erroneously put into the
    // frozenSet, it would appear to succeed.
    harden(c);
  }
  const objs = s.evaluate(`(${makeObjects})`)();
  // TODO: use doHarden.
  t.end();
});
