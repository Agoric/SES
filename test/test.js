import test from 'tape';
import SES from '../src/index.js';

test('create', function(t) {
  const s = SES.makeSESRootRealm();
  t.equal(1, 1);
  t.equal(s.evaluate('1+1'), 2);
  t.end();
});

test('SESRealm does not see primal realm names', function(t) {
  let hidden = 1;
  const s = SES.makeSESRootRealm();
  t.throws(() => s.evaluate('hidden+1'), ReferenceError);
  t.end();
});

test('SESRealm also has SES', function(t) {
  const s = SES.makeSESRootRealm();
  t.equal(1, 1);
  t.equal(s.evaluate('1+1'), 2);
  t.equal(s.evaluate(`const s2 = SES.makeSESRootRealm(); s2.evaluate('1+2')`), 3);
  t.end();
});

test('SESRealm has SES.confine', function(t) {
  const s = SES.makeSESRootRealm();
  t.equal(1, 1);
  t.equal(s.evaluate('1+1'), 2);
  t.equal(s.evaluate(`SES.confine('1+2')`), 3);
  // it evals in the current RootRealm. We might test this by adding
  // something to the global, except that global has been frozen. todo:
  // if/when we add endowments to makeSESRootRealm(), set one and then test
  // that SES.confine can see it
  // s = SES.makeSESRootRealm({ a: 2 });
  // t.equal(s.evaluate(`SES.confine('a+2')`), 4);

  // SES.confine accepts endowments, which are made available in the global
  // lexical scope (*not* copied onto the global object, which is frozen
  // anyways), so they'll be available for only the duration of the eval, and
  // only as unbound names (so they could be found statically in the AST)
  t.equal(s.evaluate(`SES.confine('b+2', { b: 3 })`), 5);
  t.throws(() => s.evaluate(`SES.confine('b+2')`), ReferenceError);
  t.end();
});

test('SESRealm.SES wraps exceptions', function(t) {
  const s = SES.makeSESRootRealm();
  function fail() {
      missing;
  }
  function check(failStr) {
    try {
      SES.confine(failStr);
    } catch (e) {
      if (e instanceof ReferenceError) {
        return 'inner ReferenceError';
      }
      return 'wrong exception type';
    }
    return 'did not throw';
  }
  const failStr = `${fail}; fail()`;
  t.equal(s.evaluate(`${check}; check(failStr)`, { failStr }), 'inner ReferenceError');
  t.end();
});

test('primal realm SES does not have confine', function(t) {
  t.equal(Object.hasOwnProperty('SES'), false);
  t.end();
});

test('main use case', function(t) {
  const s = SES.makeSESRootRealm();
  function power(a) {
    return a + 1;
  }
  function attenuate(arg) {
    if (arg <= 0) {
      throw new TypeError('only positive numbers');
    }
    return power(arg);
  }
  const attenuated_power = s.evaluate(`(${attenuate})`, { power });
  function use(arg) {
    return power(arg);
  }
  const user = s.evaluate(`(${use})`, { power: attenuated_power });
  t.equal(user(1), 2);
  t.throws(() => user(-1), s.global.TypeError);
  t.end();
});

