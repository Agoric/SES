import test from 'tape';
import SES from '../src/index';

test('infix bang is disabled by default', t => {
  const s = SES.makeSESRootRealm({
    errorStackMode: 'allow',
  });
  t.throws(
    () =>
      s.evaluate('"abc"!length', {
        E(obj) {
          return obj;
        },
      }),
    SyntaxError,
  );
  t.end();
});

test('infix bang can be enabled', t => {
  const s = SES.makeSESRootRealm({
    errorStackMode: 'allow',
    infixBangResolver: 'E',
  });
  t.equals(
    s.evaluate('"abc"!length', {
      E(obj) {
        return `${obj}def`;
      },
    }),
    6,
  );
  t.equals(
    s.evaluate('({foo() { return "hello"; }})!bar()', {
      E({ foo }) {
        return { bar: foo };
      },
    }),
    'hello',
  );
  t.equals(
    s.evaluate('["a", "b", "c"]![2]', {
      E(obj) {
        return obj.reverse();
      },
    }),
    'a',
  );
  t.equals(
    s.evaluate(`eval('"abc"!length')`, {
      E(obj) {
        return `${obj}def`;
      },
    }),
    6,
  );
  t.equals(
    s.evaluate(`eval('"abc"!length')`, {
      E(obj) {
        return `${obj}def`;
      },
    }),
    6,
  );
  t.equals(
    s.evaluate(`eval('eval(\\'"abc"!length\\')')`, {
      E(obj) {
        return `${obj}def`;
      },
    }),
    6,
  );
  t.equals(
    s.evaluate(`(1,eval)('(1,eval)(\\'"abc"!length\\')')`, {
      E(obj) {
        return `${obj}def`;
      },
    }),
    6,
  );
  t.end();
});
