/*global def*/
// Copyright (C) 2011 Google Inc.
// Copyright (C) 2018 Agoric
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview
 * This is an SES implementation of ejectors, guards, and trademarks.
 *
 * @author kpreid@switchb.org, others...
 */


////////////////////////////////////////////////////////////////////////
// Trademarks
////////////////////////////////////////////////////////////////////////

const stampers = new WeakMap();

/**
 * Internal routine for making a trademark.
 *
 * To untangle a cycle, the guard made by `internalMakeTrademark` is
 * not yet stamped. The caller of `internalMakeTrademark` must stamp
 * it before allowing the guard to escape.
 */
function internalMakeTrademark(typename) {
  typename = `${typename}`;
  const marked = new WeakSet();
  
  const stamp = def({
    toString() { return `${typename}Stamp`; }
  });
  
  stampers.set(stamp, obj => {
    marked.add(obj);
    return obj;
  });

  // Caller does of def on the record so they can first trademark the
  // guard.
  return {
    toString() { return `${typename}Mark`; },
    stamp,
    guard: {
      toString() { return `${typename}T`; },
      coerce(specimen, opt_ejector) {
        if (!marked.has(specimen)) {
          eject(opt_ejector,
                `Specimen does not have the "${typename}" trademark`);
        }
        return specimen;
      }
    }
  };
}

/**
 * Objects representing guards should be marked as such, so that they
 * will pass the `GuardT` guard.
 *
 * `GuardT` is exported. However, `GuardStamp` must not be made
 * generally accessible, but rather only given to code trusted to use
 * it to deem as guards things that act in a guard-like manner: A
 * guard MUST be immutable and SHOULD be idempotent. By "idempotent",
 * we mean that
 *
 * ```js
 *     const x = g(specimen, ej); // may fail
 *     // if we're still here, then without further failure
 *     g(x) === x
 * ```
 */
const GuardMark = internalMakeTrademark('Guard');
const GuardStamp = GuardMark.stamp;

// Stamp before exporting
stampers.get(GuardStamp)(GuardMark.guard);
def(GuardMark);
export const GuardT = GuardMark.guard;


/**
 * The `makeTrademark` factory function makes a trademark, which is a
 * guard/stamp pair, where the stamp marks and freezes unfrozen
 * records as carrying that trademark and the corresponding guard
 * cerifies objects as carrying that trademark (and therefore as
 * having been marked by that stamp).
 *
 * By convention, a guard representing the type-like concept 'Foo' is
 * named 'FooT'. The corresponding stamp is 'FooStamp'. The record
 * holding both is 'FooMark'. Many guards also have `of` methods for
 * making guards like themselves but parameterized by further
 * constraints, which are usually other guards. For example, `T.ListT`
 * is the guard representing frozen array, whereas {@code
 * T.ListT.of(GuardT)} represents frozen arrays of guards.
 */
export const makeTrademark = def(typename => {
  const result = internalMakeTrademark(typename);
  stampers.get(GuardStamp)(result.guard);
  return def(result);
});

const EjectorMark = makeTrademark('Ejector');
const EjectorStamp = EjectorMark.stamp;
export const EjectorT = EjectorMark.guard;

function exitCoercer(allegedEjector) {
  EjectorT.coerce(allegedEjector,
                  _ => {
                  });
}
const ExitT = makeCoerceGuard(exitCoercer, 'Exit', 'Not an Ejector');


/**
 * Given that `stamps` is a list of stamps and `record` is a
 * non-frozen object, this marks record with the trademarks of all of
 * these stamps, and then freezes and returns the record.
 *
 * If any of these conditions do not hold, this throws.
 */
const stampAll = def((stamps, record) => {
  stamps = [...stamps];
  const numStamps = stamps.length;
  // TODO: Should nonextensible objects be stampable?
  if (Object.isFrozen(record)) {
    throw new TypeError(`Can't stamp frozen objects: ${record}`);
  }
  // First ensure that we will succeed before applying any stamps to
  // the record.
  let i;
  for (i = 0; i < numStamps; i++) {
    if (!stampers.has(stamps[i])) {
      throw new TypeError(`Can't stamp with a non-stamp: ${stamps[i]}`);
    }
  }
  Object.freeze(record);
  for (i = 0; i < numStamps; i++) {
    // Only works for real stamps, postponing the need for a
    // user-implementable auditing protocol.
    stampers.get(stamps[i])(record);
  }
  return record;
});


////////////////////////////////////////////////////////////////////////
// Ejectors
////////////////////////////////////////////////////////////////////////

/**
 * One-arg form is known in scheme as "call with escape continuation"
 * (call/ec).
 *
 * In this analogy, a call to `callWithEjector` emulates a labeled
 * statement. The ejector passed to the `attemptFunc` emulates the
 * label part. The `attemptFunc` itself emulates the statement being
 * labeled. And a call to this ejector emulates the return-to-label
 * statement.
 *
 * We extend the normal notion of call/ec with an `opt_failFunc` in
 * order to give more the sense of a `try/catch` (or similarly, the
 * `escape` special form in E). The `attemptFunc` is like the `try`
 * clause and the `opt_failFunc` is like the `catch` clause. If
 * omitted, `opt_failFunc` defaults to the `identity` function.
 *
 * `callWithEjector` creates a fresh ejector -- a one argument
 * function -- for exiting from this attempt. It then calls
 * `attemptFunc` passing that ejector as argument. If `attemptFunc`
 * completes without calling the ejector, then this call to
 * `callWithEjector` completes likewise. Otherwise, if the ejector is
 * called with an argument, then `opt_failFunc` is called with that
 * argument. The completion of `opt_failFunc` is then the completion
 * of the `callWithEjector` as a whole.
 *
 * The ejector stays live until `attemptFunc` is exited, at which
 * point the ejector is disabled. Calling a disabled ejector throws.
 *
 * Note that the ejector relies on `try..catch`, so it's not entirely
 * bulletproof. The `attemptFunc` can block an ejection with a
 * `try..catch` or a `try..finally` that throws, so you should be
 * careful about what code is run in the attemptFunc.
 *
 * Historic note: This was first invented by John C. Reynolds in <a
 * href="http://doi.acm.org/10.1145/800194.805852" >Definitional
 * interpreters for higher-order programming languages</a>. Reynold's
 * invention was a special form as in E, rather than a higher order
 * function as here and in call/ec.
 */
export const callWithEjector = def((attemptFunc, failFunc = (x => x)) => {
  let disabled = false;
  const ejection = Symbol('ejection');
  let stash = void 0;
  const ejector = stampAll([EjectorStamp], result => {
    if (disabled) {
      throw new Error('ejector disabled');
    } else {
      // don't disable here.
      stash = result;
      throw ejection;
    }
  });
  try {
    try {
      return attemptFunc(ejector);
    } finally {
      disabled = true;
    }
  } catch (e) {
    if (e === ejection) {
      return failFunc(stash);
    } else {
      throw e;
    }
  }
});


////////////////////////////////////////////////////////////////////////
// Guards
////////////////////////////////////////////////////////////////////////

/**
 * First ensures that g is a guard; then does
 * `g.coerce(specimen, opt_ejector)`.
 */
export const guard = def((g, specimen, opt_ejector) => {
  g = GuardT.coerce(g); // failure throws rather than ejects
  return g.coerce(specimen, opt_ejector);
});

/**
 * First ensures that g is a guard; then checks whether the specimen
 * passes that guard.
 *
 * If g is a coercing guard, this only checks that g coerces the
 * specimen to something rather than failing. Note that trademark
 * guards are non-coercing, so if specimen passes a trademark guard,
 * then specimen itself has been marked with that trademark.
 */
export const passesGuard = def((g, specimen) => {
  g = GuardT.coerce(g); // failure throws rather than ejects
  return callWithEjector(
    ejector => {
      g.coerce(specimen, ejector);
      return true;
    },
    _ => false
  );
});


/**
 * Create a guard which passes all object passed by `pred`.  This
 * may be used to define trademark-like systems which do not require
 * the object to be frozen.
 *
 * `typename` is used for toString and `errorMessage` is used when an
 * object does not pass the guard.
 */
export const makeCoerceGuard = def((coercer, typename, errorMessage) => {
  const everPassed = new WeakSet();
  // Don't def yet, as we still need to stamp as a guard.
  const g = {
    toString() { return `${typename}T`; },
    coerce(specimen, opt_ejector) {
      if (Object(specimen) === specimen) {
        if (everPassed.has(specimen)) {
          return specimen;
        }
        const coerced = coercer(specimen, errorMessage);
        if (Object(coerced) === coerced) {
          everPassed.add(coerced);
          return coerced;
        }
      }
      throw ExitT.coerce(opt_ejector)(errorMessage);
    }
  };
  stampAll([GuardStamp], g);
  return def(g);
});


////////////////////////////////////////////////////////////////////////
// Sealing and Unsealing
////////////////////////////////////////////////////////////////////////

// TODO: Add brands from module keys issue.
// TODO: Trademark sealer, unsealers, and boxes as obeying the
//       Sealer/Unsealer/Box contract

export const makeSealerUnsealerPair = def(() => {
  const boxValues = new WeakMap();

  return def({
    seal(value) {
      const box = def({});
      boxValues.set(box, value);
      return box;
    },
    optUnseal(box) {
      return boxValues.get(box);
    },
    unseal(box) {
      if (!boxValues.has(box)) {
        throw new Error("That wasn't one of my sealed boxes!");
      }
      return boxValues.get(box);
    }
  });
});


