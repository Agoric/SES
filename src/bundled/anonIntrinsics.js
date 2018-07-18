// Copyright (C) 2011 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Monkey patch almost ES5 platforms into a closer
 * emulation of full <a href=
 * "https://code.google.com/p/es-lab/wiki/SecureableES5">Secureable
 * ES5</a>.
 *
 * <p>Assumes only ES3, but only proceeds to do useful repairs when
 * the platform is close enough to ES5 to be worth attempting
 * repairs. Compatible with almost-ES5, ES5, ES5-strict, and
 * anticipated ES6.
 *
 * <p>Ignore the "...requires ___global_test_function___" below. We
 * create it, use it, and delete it all within this module. But we
 * need to lie to the linter since it can't tell.
 *
 * //requires ses.logger, ses._EarlyStringMap,
 * //requires ses.severities, ses.statuses, ses._repairer
 * //optionally requires ses.mitigateSrcGotchas, ses._primordialsHaveBeenFrozen
 * //provides ses.ok, ses.okToLoad, ses.getMaxSeverity, ses.updateMaxSeverity
 * //provides ses.is, ses.makeDelayedTamperProof
 * //provides ses.isInBrowser
 * //provides ses.makeCallerHarmless, ses.makeArgumentsHarmless
 * //provides ses.noFuncPoison
 * //provides ses.verifyStrictFunctionBody
 * //provides ses.getUndeniables, ses.earlyUndeniables
 * //provides ses.getAnonIntrinsics
 * //provides ses.funcLike, ses.kludge_test_FREEZING_BREAKS_PROTOTYPES
 *
 * @author Mark S. Miller
 * @requires ___global_test_function___, ___global_valueOf_function___
 * @requires JSON, eval, this
 * @requires navigator, document, DOMException
 * @overrides ses, repairES5Module
 * @overrides RegExp, WeakMap, Object, parseInt
 */
var RegExp;
var ses;

// TODO(erights): We should test for
// We now have a reason to omit Proxy from the whitelist.
// The makeBrandTester in repairES5 uses Allen's trick at
// https://esdiscuss.org/topic/tostringtag-spoofing-for-null-and-undefined#content-59
// , but testing reveals that, on FF 35.0.1, a proxy on an exotic
// object X will pass this brand test when X will. This is fixed as of
// FF Nightly 38.0a1.



/**
 * <p>Qualifying platforms generally include all JavaScript platforms
 * shown on <a href="http://kangax.github.com/es5-compat-table/"
 * >ECMAScript 5 compatibility table</a> that implement {@code
 * Object.getOwnPropertyNames}. At the time of this writing,
 * qualifying browsers already include the latest released versions of
 * Internet Explorer (9), Firefox (4), Chrome (11), and Safari
 * (5.0.5), their corresponding standalone (e.g., server-side) JavaScript
 * engines, Rhino 1.73, and BESEN.
 *
 * <p>On such not-quite-ES5 platforms, some elements of these
 * emulations may lose SES safety, as enumerated in the comment on
 * each problem record in the {@code baseProblems} and {@code
 * supportedProblems} array below. The platform must at least provide
 * {@code Object.getOwnPropertyNames}, because it cannot reasonably be
 * emulated.
 *
 * <p>This file is useful by itself, as it has no dependencies on the
 * rest of SES. It creates no new global bindings, but merely repairs
 * standard globals or standard elements reachable from standard
 * globals. If the future-standard {@code WeakMap} global is present,
 * as it is currently on FF7.0a1, then it will repair it in place. The
 * one non-standard element that this file uses is {@code console} if
 * present, in order to report the repairs it found necessary, in
 * which case we use its {@code log, info, warn}, and {@code error}
 * methods. If {@code console.log} is absent, then this file performs
 * its repairs silently.
 *
 * <p>Generally, this file should be run as the first script in a
 * JavaScript context (i.e. a browser frame), as it relies on other
 * primordial objects and methods not yet being perturbed.
 *
 * <p>TODO(erights): This file tries to protect itself from some
 * post-initialization perturbation by stashing some of the
 * primordials it needs for later use, but this attempt is currently
 * incomplete. We need to revisit this when we support Confined-ES5,
 * as a variant of SES in which the primordials are not frozen. See
 * previous failed attempt at <a
 * href="https://codereview.appspot.com/5278046/" >Speeds up
 * WeakMap. Preparing to support unfrozen primordials.</a>. From
 * analysis of this failed attempt, it seems that the only practical
 * way to support CES is by use of two frames, where most of initSES
 * runs in a SES frame, and so can avoid worrying about most of these
 * perturbations.
 */
(function repairES5Module(global) {
  "use strict";

  var logger = ses.logger;
  var EarlyStringMap = ses._EarlyStringMap;

  var severities = ses.severities;
  var statuses = ses.statuses;

  /**
   * As we start to repair, this will track the worst post-repair
   * severity seen so far.
   *
   * TODO(kpreid): Revisit this; it's a shim for the old "ses.maxSeverity"
   * which is no longer a global property since it's now internal state of
   * the repairer.
   */
   ses.getMaxSeverity = function getMaxSeverity() {
     return ses._repairer.getCurrentSeverity();
   };

  /**
   * Are we in a condition to safely operate as SES?
   *
   * TODO(kpreid): This should subsume the 'dirty' flag from startSES
   * by making that into a "problem".
   */
  ses.ok = function ok(maxSeverity) {
    return ses._repairer.okToUse(maxSeverity);
  };

  /**
   * Are we in a condition to continue initializing SES (as opposed to
   * aborting)?
   *
   * Does not take a max severity argument because the severity during loading
   * is pre-chosen by maxAcceptableSeverity.
   */
  ses.okToLoad = function okToLoad() {
    if (arguments.length !== 0) {
      // catch a plausible mistake
      throw new Error('okToLoad takes no arguments');
    }
    return ses._repairer.okToLoad();
  };

  /**
   * Update the max based on the provided severity.
   *
   * <p>If the provided severity exceeds the max so far, update the
   * max to match.
   */
  ses.updateMaxSeverity = function updateMaxSeverity(severity) {
    // TODO(kpreid): Replace uses of this with new repair framework
    return ses._repairer.updateMaxSeverity(severity);
  };

  //////// Prepare for "caller" and "argument" testing and repair /////////

  /**
   * Needs to work on ES3, since repairES5.js may be run on an ES3
   * platform.
   */
  function strictForEachFn(list, callback) {
    for (var i = 0, len = list.length; i < len; i++) {
      callback(list[i], i);
    }
  }

  /**
   * A known strict-mode function for tests to use.
   */
  function strictFnSpecimen() {}

  /**
   * Sample map early, to obtain a representative built-in for testing.
   *
   * <p>There is no reliable test for whether a function is a
   * built-in, and it is possible some of the tests below might
   * replace the built-in Array.prototype.map, though currently none
   * do. Since we <i>assume</i> (but with no reliable way to check)
   * that repairES5.js runs in its JavaScript context before anything
   * which might have replaced map, we sample it now. The map method
   * is a particularly nice one to sample, since it can easily be used
   * to test what the "caller" and "arguments" properties on a
   * in-progress built-in method reveals.
   */
  var builtInMapMethod = Array.prototype.map;

  var builtInForEach = Array.prototype.forEach;

  /**
   * At https://bugs.ecmascript.org/show_bug.cgi?id=3113#c24 Jason
   * Orendorff states the best draft for a simpler safe spec for the
   * .caller and .argument properties on functions, that may or may
   * not make it into ES6, but is on a track to standardization
   * regardless. In Firefox 34 and
   * https://bugzilla.mozilla.org/show_bug.cgi?id=969478 apparently
   * this was implemented, or a reasonable approximation that we need
   * to determine can be made SES-safe. Since this is a very different
   * situation that the ES5 spec for these, we test which regime we
   * seem to be in up front, so we can switch other logic based on this.
   *
   * If we seem to be in the new regime, then we try to delete the
   * poison properties for simple safety, rather than trying to find
   * subtle corner cases by which they might lose safety. If any of
   * this fails, then we proceed under the assumption we're in the old
   * regime.
   *
   * If noFuncPoison, then we're in the new regime made simply safe by
   * these deletions, and we do not treat the names 'caller' and
   * 'arguments' on functions as special.
   */
  var noFuncPoison =
      Function.prototype.hasOwnProperty('caller') &&
      Function.prototype.hasOwnProperty('arguments') &&
      !strictFnSpecimen.hasOwnProperty('caller') &&
      !strictFnSpecimen.hasOwnProperty('arguments') &&
      !builtInMapMethod.hasOwnProperty('caller') &&
      !builtInMapMethod.hasOwnProperty('arguments') &&
      delete Function.prototype.caller &&
      delete Function.prototype.arguments &&
      !Function.prototype.hasOwnProperty('caller') &&
      !Function.prototype.hasOwnProperty('arguments');
  ses.noFuncPoison = noFuncPoison;


  /**
   * http://wiki.ecmascript.org/doku.php?id=harmony:egal
   */
  var is = ses.is = Object.is || function(x, y) {
    if (x === y) {
      // 0 === -0, but they are not identical
      return x !== 0 || 1 / x === 1 / y;
    }

    // NaN !== NaN, but they are identical.
    // NaNs are the only non-reflexive value, i.e., if x !== x,
    // then x is a NaN.
    // isNaN is broken: it converts its argument to number, so
    // isNaN("foo") => true
    return x !== x && y !== y;
  };


  /**
   * By the time this module exits, either this is repaired to be a
   * function that is adequate to make the "caller" property of a
   * strict or built-in function harmess, or this module has reported
   * a failure to repair.
   *
   * <p>Start off with the optimistic assumption that nothing is
   * needed to make the "caller" property of a strict or built-in
   * function harmless. We are not concerned with the "caller"
   * property of non-strict functions. It is not the responsibility of
   * this module to actually make these "caller" properties
   * harmless. Rather, this module only provides this function so
   * clients such as startSES.js can use it to do so on the functions
   * they whitelist.
   *
   * <p>If the "caller" property of strict functions are not already
   * harmless, then this platform cannot be repaired to be
   * SES-safe. The only reason why {@code makeCallerHarmless} must
   * work on strict functions in addition to built-in is that some of
   * the other repairs below will replace some of the built-ins with
   * strict functions, so startSES.js will apply {@code
   * makeCallerHarmless} blindly to both strict and built-in
   * functions. {@code makeCallerHarmless} simply need not to complete
   * without breaking anything when given a strict function argument.
   */
  ses.makeCallerHarmless = function assumeCallerHarmless(func, path) {
    return 'Apparently fine';
  };

  /**
   * By the time this module exits, either this is repaired to be a
   * function that is adequate to make the "arguments" property of a
   * strict or built-in function harmess, or this module has reported
   * a failure to repair.
   *
   * Exactly analogous to {@code makeCallerHarmless}, but for
   * "arguments" rather than "caller".
   */
  ses.makeArgumentsHarmless = function assumeArgumentsHarmless(func, path) {
    return 'Apparently fine';
  };

  var simpleTamperProofOk = false;

  /**
   * "makeTamperProof()" returns a "tamperProof(obj, opt_pushNext)"
   * function that acts like "Object.freeze(obj)", except that, if obj
   * is a <i>prototypical</i> object (defined below), it ensures that
   * the effect of freezing properties of obj does not suppress the
   * ability to override these properties on derived objects by simple
   * assignment.
   *
   * <p>If opt_pushNext is provided, then it is called for each value
   * obtained from an own property by reflective property access, so
   * that tamperProof's caller can arrange to visit each of these
   * values after tamperProof returns if it wishes to recur.
   *
   * <p>Because of lack of sufficient foresight at the time, ES5
   * unfortunately specified that a simple assignment to a
   * non-existent property must fail if it would override a
   * non-writable data property of the same name. (In retrospect, this
   * was a mistake, but it is now too late and we must live with the
   * consequences.) As a result, simply freezing an object to make it
   * tamper proof has the unfortunate side effect of breaking
   * previously correct code that is considered to have followed JS
   * best practices, if this previous code used assignment to
   * override.
   *
   * <p>To work around this mistake, tamperProof(obj) detects if obj
   * is <i>prototypical</i>, i.e., is an object whose own
   * "constructor" is a function whose "prototype" is this obj. For example,
   * Object.prototype and Function.prototype are prototypical.  If so,
   * then when tamper proofing it, prior to freezing, replace all its
   * configurable own data properties with accessor properties which
   * simulate what we should have specified -- that assignments to
   * derived objects succeed if otherwise possible. In this case,
   * opt_pushNext, if provided, is called on the value that this data
   * property had <i>and</i> on the accessors which replaced it.
   *
   * <p>Some platforms (Chrome and Safari as of this writing)
   * implement the assignment semantics ES5 should have specified
   * rather than what it did specify.
   * "test_ASSIGN_CAN_OVERRIDE_FROZEN()" below tests whether we are on
   * such a platform. If so, "repair_ASSIGN_CAN_OVERRIDE_FROZEN()"
   * sets simpleTamperProofOk, which informs makeTamperProof that the
   * complex workaround here is not needed on those platforms. If
   * opt_pushNext is provided, it must still use reflection to obtain
   * those values.
   *
   * <p>"makeTamperProof" should only be called after the trusted
   * initialization has done all the monkey patching that it is going
   * to do on the Object.* methods, but before any untrusted code runs
   * in this context.
   */
  function makeTamperProof() {

    // Sample these after all trusted monkey patching initialization
    // but before any untrusted code runs in this frame.
    var gopd = Object.getOwnPropertyDescriptor;
    var gopn = Object.getOwnPropertyNames;
    var freeze = Object.freeze;
    var isFrozen = Object.isFrozen;
    var defProp = Object.defineProperty;
    var call = Function.prototype.call;

    function forEachNonPoisonOwn(obj, callback) {
      var list = gopn(obj);
      var len = list.length;
      var i, j, name;  // crockford rule
      if (typeof obj === 'function') {
        for (i = 0, j = 0; i < len; i++) {
          name = list[i];
          if (noFuncPoison || (name !== 'caller' && name !== 'arguments')) {
            callback(name, j);
            j++;
          }
        }
      } else {
        strictForEachFn(list, callback);
      }
    }

    function simpleTamperProof(obj, opt_pushNext) {
      if (obj !== Object(obj)) { return obj; }
      if (opt_pushNext) {
        forEachNonPoisonOwn(obj, function(name) {
          var desc = gopd(obj, name);
          if ('value' in desc) {
            opt_pushNext(desc.value);
          } else {
            opt_pushNext(desc.get);
            opt_pushNext(desc.set);
          }
        });
      }
      return freeze(obj);
    }

    function tamperProof(obj, opt_pushNext) {
      if (obj !== Object(obj)) { return obj; }
      var func;
      if ((typeof obj === 'object' || obj === Function.prototype) &&
          !!gopd(obj, 'constructor') &&
          typeof (func = obj.constructor) === 'function' &&
          func.prototype === obj &&
          !isFrozen(obj)) {
        var pushNext = opt_pushNext || function(v) {};
        forEachNonPoisonOwn(obj, function(name) {
          var value;
          function getter() {
            return value;
          }

          function setter(newValue) {
            if (obj === this) {
              throw new TypeError('Cannot set virtually frozen property: ' +
                                  name);
            }
            if (!!gopd(this, name)) {
              this[name] = newValue;
            }
            // TODO(erights): Do all the inherited property checks
            defProp(this, name, {
              value: newValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          }
          var desc = gopd(obj, name);
          if ('value' in desc) {
            value = desc.value;
            // On some engines, and perhaps to become standard in ES6,
            // __proto__ already behaves as an accessor but is made to
            // appear to be a data property, so we should not try to
            // reconfigure it into another accessor.
            if (desc.configurable && name !== '__proto__') {
              getter.prototype = null;
              setter.prototype = null;
              defProp(obj, name, {
                get: getter,
                set: setter,
                // We should be able to omit the enumerable line, since it
                // should default to its existing setting.
                enumerable: desc.enumerable,
                configurable: false
              });
              pushNext(getter);
              pushNext(setter);
            }
            pushNext(value);
          } else {
            pushNext(desc.get);
            pushNext(desc.set);
          }
        });
        return freeze(obj);
      } else {
        return simpleTamperProof(obj, opt_pushNext);
      }
    }
    return simpleTamperProofOk ? simpleTamperProof : tamperProof;
  };


  var needToTamperProof = [];
  /**
   * Various repairs may expose non-standard objects that are not
   * reachable from startSES's root, and therefore not freezable by
   * startSES's normal whitelist traversal. However, freezing these
   * during repairES5.js may be too early, as it is before WeakMap.js
   * has had a chance to monkey patch Object.freeze if necessary, in
   * order to install hidden properties for its own use before the
   * object becomes non-extensible.
   * TODO(kpreid): Revisit this time-of-execution commentary in new world
   */
  function rememberToTamperProof(obj) {
    needToTamperProof.push(obj);
  }

  /**
   * Makes and returns a tamperProof(obj) function, and uses it to
   * tamper proof all objects whose tamper proofing had been delayed.
   *
   * <p>"makeDelayedTamperProof()" must only be called once.
   */
  var makeDelayedTamperProofCalled = false;
  ses.makeDelayedTamperProof = function makeDelayedTamperProof() {
    if (makeDelayedTamperProofCalled) {
      throw 'makeDelayedTamperProof() must only be called once.';
    }
    var tamperProof = makeTamperProof();
    strictForEachFn(needToTamperProof, tamperProof);
    needToTamperProof = void 0;
    makeDelayedTamperProofCalled = true;
    return tamperProof;
  };


  ////////////////////// Brand testing /////////////////////

  /**
   * Note that, as of ES5, Object.prototype.toString.call(foo) (for
   * the original Object.prototype.toString and original
   * Function.prototype.call) was a reliable branding mechanism for
   * distinguishing the built-in types. This is no longer true of ES6
   * once untrusted code runs in that realm, and so should no longer
   * be used for that purpose. See makeBrandTester and the brands it
   * makes.
   */
  var objToString = Object.prototype.toString;

  /**
   * For reliably testing that a specimen is an exotic object of some
   * built-in exotic type.
   *
   * <p>The exotic type should be those objects normally made by
   * ctor. methodName must be the name of a method on ctor.prototype
   * that, when applied to an exotic object of this exotic type as
   * this-value, with the provided args list, will return without
   * error, but when applied to any other object as this-value will
   * throw an error. opt_example, if provided, must be an example of
   * such an exotic object that can be used for internal sanity
   * checking before returning a brandTester.
   *
   * <p>Uses Allen's trick from
   * https://esdiscuss.org/topic/tostringtag-spoofing-for-null-and-undefined#content-59
   * for brand testing that will remain reliable in ES6.
   * However, testing reveals that, on FF 35.0.1, a proxy on an exotic
   * object X will pass this brand test when X will. This is fixed as of
   * FF Nightly 38.0a1.
   *
   * <p>Returns a brandTester function such that, if brandTester(specimen)
   * returns true, this is a reliable indicator that specimen actually
   * is an exotic object of that type.
   *
   * <p>As a convenience, ctor may be undefined, in which
   * case we assume that there are no exotic objects of that kind. In
   * this case, the returned brandTester always says false.
   */
  function makeBrandTester(ctor, methodName, args, opt_example) {
    if (ctor === void 0) {
      // If there is no built-in ctor, then we assume there cannot
      // be any objects that are genuinely of that brand.
      return function absentCtorBrandTester(specimen) { return false; };
    }
    var originalMethod = ctor.prototype[methodName];
    function brandTester(specimen) {
      if (specimen !== Object(specimen)) { return false; }
      try {
        originalMethod.apply(specimen, args);
        return true;
      } catch (_) {
        return false;
      }
    };
    // a bit of sanity checking before proceeding
    var counterExamples = [null, void 0, true, 1, 'x', {}];
    if (opt_example !== void 0) {
      counterExamples.push({valueOf: function() { return opt_example; }});
      counterExamples.push(Object.create(opt_example));
    }
    strictForEachFn(counterExamples, function(v, i) {
      if (brandTester(v)) {
        logger.error('Brand test ' + i + ' for ' + ctor + ' passed: ' + v);
        ses._repairer.updateMaxSeverity(severities.NOT_SUPPORTED);
      }
    });
    if (opt_example !== void 0 && typeof global.Proxy === 'function') {
      // We treat the Proxy counter-example more gently for two reasons:
      // * The test fails as of FF 35.0.1, which, as of this writing,
      //   Caja must still support.
      // * It currently does not cause an insecurity for us, since we
      //   do not yet whitelist Proxy. We might use it internally (see
      //   startSES.js) but we do not yet make it available to any
      //   code running within SES.
      // See https://bugzilla.mozilla.org/show_bug.cgi?id=1133249
      // TODO(erights): Add a test for this to test262
      // TODO(erights): Extract all these self-tests into tests
      // performed within the repair framework.
      // TODO(erights): Add a self-test that will catch any
      // whitelisting of Proxy while this is still an issue.
      var proxy = new global.Proxy(opt_example, {});
      if (brandTester(proxy)) {
        logger.warn('Brand test of proxy for ' + ctor + ' passed: ' + proxy);
        ses._repairer.updateMaxSeverity(severities.SAFE_SPEC_VIOLATION);
      }
    }
    if (opt_example !== void 0 && !brandTester(opt_example)) {
      logger.error('Brand test for ' + ctor + ' failed: ' + opt_example);
      ses._repairer.updateMaxSeverity(severities.NOT_SUPPORTED);
    }
    return brandTester;
  }

  /**
   * A reliable brand test for whether specimen has a [[Class]] of
   * "Date", or, in ES6 terminology, whether it has a [[DateValue]]
   * internal slot.
   */
  var isBuiltinDate = makeBrandTester(
      Date, 'getDay', [], new Date());

  /**
   * A reliable brand test for whether specimen has a [[Class]] of
   * "Number", or, in ES6 terminology, whether it has a [[NumberData]]
   * internal slot.
   */
  var isBuiltinNumberObject = makeBrandTester(
      Number, 'toString', [], new Number(3));

  /**
   * A reliable brand test for whether specimen has a [[Class]] of
   * "Boolean", or, in ES6 terminology, whether it has a [[BooleanData]]
   * internal slot.
   */
  var isBuiltinBooleanObject = makeBrandTester(
      Boolean, 'toString', [], new Boolean(true));

  /**
   * A reliable brand test for whether specimen has a [[Class]] of
   * "String", or, in ES6 terminology, whether it has a [[StringData]]
   * internal slot.
   */
  var isBuiltinStringObject = makeBrandTester(
      String, 'toString', [], new String('y'));

  /**
   * A reliable brand test for whether specimen has a [[Class]] of
   * "RegExp", or, in ES6 terminology, whether it has a [[RegExpMatcher]]
   * internal slot.
   */
  var isBuiltinRegExp = makeBrandTester(
      RegExp, 'exec', ['x'], /x/);

  /**
   * A reliable brand test for whether specimen has a [[WeakMapData]]
   * internal slot.
   */
  var isBuiltinWeakMap = makeBrandTester(
      global.WeakMap, 'get', [{}], global.WeakMap ? new WeakMap() : void 0);


  //////////////// Undeniables and Intrinsics //////////////


  /**
   * A known strict function which returns its arguments object.
   */
  function strictArguments() { return arguments; }

  /**
   * A known sloppy function which returns its arguments object.
   *
   * Defined using Function so it'll be sloppy (not strict and not
   * builtin).
   */
  var sloppyArguments = Function('return arguments;');

  /**
   * If present, a known strict generator function which yields its
   * arguments object.
   *
   * <p>TODO: once all supported browsers implement ES6 generators, we
   * can drop the "try"s below, drop the check for old Mozilla
   * generator syntax, and treat strictArgumentsGenerator as
   * unconditional in the test of the code.
   */
  var strictArgumentsGenerator = void 0;
  try {
    // ES6 syntax
    strictArgumentsGenerator =
        eval('(function*() { "use strict"; yield arguments; })');
  } catch (ex) {
    if (!(ex instanceof SyntaxError)) { throw ex; }
    try {
      // Old Firefox syntax
      strictArgumentsGenerator =
          eval('(function() { "use strict"; yield arguments; })');
    } catch (ex2) {
      if (!(ex2 instanceof SyntaxError)) { throw ex2; }
    }
  }

  /**
   * The undeniables are the primordial objects which are ambiently
   * reachable via compositions of strict syntax, primitive wrapping
   * (new Object(x)), and prototype navigation (the equivalent of
   * Object.getPrototypeOf(x) or x.__proto__). Although we could in
   * theory monkey patch primitive wrapping or prototype navigation,
   * we won't. Hence, without parsing, the following are undeniable no
   * matter what <i>other</i> monkey patching we do to the primordial
   * environment.
   */
  function getUndeniables() {
    var gopd = Object.getOwnPropertyDescriptor;
    var getProto = Object.getPrototypeOf;

    // The first element of each undeniableTuple is a string used to
    // name the undeniable object for reporting purposes. It has no
    // other programmatic use.
    //
    // The second element of each undeniableTuple should be the
    // undeniable itself.
    //
    // The optional third element of the undeniableTuple, if present,
    // should be an example of syntax, rather than use of a monkey
    // patchable API, evaluating to a value from which the undeniable
    // object in the second element can be reached by only the
    // following steps:
    // If the value is primitve, convert to an Object wrapper.
    // Is the resulting object either the undeniable object, or does
    // it inherit directly from the undeniable object?

    var undeniableTuples = [
        ['Object.prototype', Object.prototype, {}],
        ['Function.prototype', Function.prototype, function(){}],
        ['Array.prototype', Array.prototype, []],
        ['RegExp.prototype', RegExp.prototype, /x/],
        ['Boolean.prototype', Boolean.prototype, true],
        ['Number.prototype', Number.prototype, 1],
        ['String.prototype', String.prototype, 'x'],
    ];
    var result = {};

    // Get the ES6 %Generator% intrinsic, if present.
    // It is undeniable because individual generator functions inherit
    // from it.
    (function() {
      // See http://people.mozilla.org/~jorendorff/figure-2.png
      // i.e., Figure 2 of section 25.2 "Generator Functions" of the
      // ES6 spec.
      // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorfunction-objects
      if (!strictArgumentsGenerator) { return; }
      var Generator = getProto(strictArgumentsGenerator);
      undeniableTuples.push(['%Generator%', Generator,
                             strictArgumentsGenerator]);
      strictArgumentsGenerator = strictArgumentsGenerator;
    }());

    strictForEachFn(undeniableTuples, function(tuple) {
      var name = tuple[0];
      var undeniable = tuple[1];
      var start = tuple[2];
      result[name] = undeniable;
      if (start === void 0) { return; }
      start = Object(start);
      if (undeniable === start) { return; }
      if (undeniable === getProto(start)) { return; }
      throw new Error('Unexpected undeniable: ' + undeniable);
    });

    return result;
  }
  ses.getUndeniables = getUndeniables;

  // For consistency checking, once we've done all our whitelist
  // processing and monkey patching, we will call getUndeniables again
  // and check that the undeniables are the same.
  ses.earlyUndeniables = getUndeniables();


  function registerIteratorProtos(registery, base, name) {
    var iteratorSym = global.Symbol && global.Symbol.iterator ||
        "@@iterator"; // used instead of a symbol on FF35
    var getProto = Object.getPrototypeOf;

    if (base[iteratorSym]) {
      var anIter = base[iteratorSym]();
      var anIteratorPrototype = getProto(anIter);
      registery[name] = anIteratorPrototype;
      var anIterProtoBase = getProto(anIteratorPrototype);
      if (anIterProtoBase !== Object.prototype) {
        if (!registery.IteratorPrototype) {
          if (getProto(anIterProtoBase) !== Object.prototype) {
            throw new Error(
              '%IteratorPrototype%.__proto__ was not Object.prototype');
          }
          registery.IteratorPrototype = anIterProtoBase;
        } else {
          if (registery.IteratorPrototype !== anIterProtoBase) {
            throw new Error('unexpected %' + name + '%.__proto__');
          }
        }
      }
    }
  }


  /**
   * Get the intrinsics not otherwise reachable by named own property
   * traversal. See
   * https://people.mozilla.org/~jorendorff/es6-draft.html#sec-well-known-intrinsic-objects
   * and the instrinsics section of whitelist.js
   *
   * <p>Unlike getUndeniables(), the result of getAnonIntrinsics()
   * does depend on the current state of the primordials, so we must
   * run this again after all other relevant monkey patching is done,
   * in order to properly initialize cajaVM.intrinsics
   */
  function getAnonIntrinsics() {
    var gopd = Object.getOwnPropertyDescriptor;
    var getProto = Object.getPrototypeOf;
    var result = {};

    // If there are still other ThrowTypeError objects left after
    // noFuncPoison-ing, this should be caught by
    // test_THROWTYPEERROR_NOT_UNIQUE below, so we assume here that
    // this is the only surviving ThrowTypeError intrinsic.
    result.ThrowTypeError = gopd(arguments, 'callee').get;

    // Get the ES6 %ArrayIteratorPrototype%,
    // %StringIteratorPrototype%, %MapIteratorPrototype%,
    // %SetIteratorPrototype% and %IteratorPrototype% intrinsics, if
    // present.
    (function() {
      registerIteratorProtos(result, [], 'ArrayIteratorPrototype');
      registerIteratorProtos(result, '', 'StringIteratorPrototype');
      if (typeof Map === 'function') {
        registerIteratorProtos(result, new Map(), 'MapIteratorPrototype');
      }
      if (typeof Set === 'function') {
        registerIteratorProtos(result, new Set(), 'SetIteratorPrototype');
      }
    }());

    // Get the ES6 %GeneratorFunction% intrinsic, if present.
    (function() {
      var Generator = ses.earlyUndeniables['%Generator%'];
      if (!Generator || Generator === Function.prototype) { return; }
      if (getProto(Generator) !== Function.prototype) {
        throw new Error('Generator.__proto__ was not Function.prototype');
      }
      var GeneratorFunction = Generator.constructor;
      if (GeneratorFunction === Function) { return; }
      if (getProto(GeneratorFunction) !== Function) {
        throw new Error('GeneratorFunction.__proto__ was not Function');
      }
      result.GeneratorFunction = GeneratorFunction;
      var genProtoBase = getProto(Generator.prototype);
      if (genProtoBase !== result.IteratorPrototype &&
          genProtoBase !== Object.prototype) {
        throw new Error('Unexpected Generator.prototype.__proto__');
      }
    }());

    // Get the ES6 %TypedArray% intrinsic, if present.
    (function() {
      if (!global.Float32Array) { return; }
      var TypedArray = getProto(global.Float32Array);
      if (TypedArray === Function.prototype) { return; }
      if (getProto(TypedArray) !== Function.prototype) {
        // http://bespin.cz/~ondras/html/classv8_1_1ArrayBufferView.html
        // has me worried that someone might make such an intermediate
        // object visible.
        throw new Error('TypedArray.__proto__ was not Function.prototype');
      }
      result.TypedArray = TypedArray;
    }());

    for (var name in result) {
      if (result[name] === void 0) {
        throw new Error('Malformed intrinsic: ' + name);
      }
    }

    return result;
  }
  ses.getAnonIntrinsics = getAnonIntrinsics;

  var unsafeIntrinsics = getAnonIntrinsics();


  //////////////////////////////////////////////////////////

  /**
   * Fails if {@code funcBodySrc} does not parse as a strict
   * FunctionBody.
   *
   * <p>ses.verifyStrictFunctionBody is exported from repairES5
   * because the best way to perform this verification on a given
   * platform depends on whether the platform's Function constructor
   * <a href=
   * "https://code.google.com/p/google-caja/issues/detail?id=1616"
   * >fails to verify that its body parses as a FunctionBody</a>. If
   * it does, repairES5 could have repaired the Function constructor
   * itself, but chooses not to, since its main client, startSES, has
   * to wrap and replace the Function constructor anyway.
   *
   * <p>On platforms not suffering from this bug,
   * ses.verifyStrictFunctionBody just calls the original Function
   * constructor to do this verification (See
   * simpleVerifyStrictFunctionBody). Otherwise, we repair
   * ses.verifyStrictFunctionBody
   *
   * <p>See verifyStrictFunctionBodyByEvalThrowing and
   * verifyStrictFunctionBodyByParsing.
   *
   * <p>Note that all verify*(allegedString) functions now always
   * start by coercing the alleged string to a guaranteed primitive
   * string, do their verification checks on that, and if it passes,
   * returns that. Otherwise they throw. If you don't know whether
   * something is a string before verifying, use only the output of
   * the verifier, not the input. Or coerce it early yourself.
   */
  ses.verifyStrictFunctionBody = simpleVerifyStrictFunctionBody;

  /**
   * The unsafe* variables hold precious values that must not escape
   * to untrusted code. When {@code eval} is invoked via {@code
   * unsafeEval}, this is a call to the indirect eval function, not
   * the direct eval operator.
   */
  var unsafeEval = eval;
  var UnsafeFunction = Function;

  /**
   * <p>We use Crock's trick of simply passing {@code funcBodySrc} to
   * the original {@code Function} constructor, which will throw a
   * SyntaxError if it does not parse as a FunctionBody.
   */
  function simpleVerifyStrictFunctionBody(funcBodySrc) {
    funcBodySrc = ''+funcBodySrc;
    UnsafeFunction('"use strict";' + funcBodySrc);
    return funcBodySrc;
  }

  /**
   * If Crock's trick is not safe, then
   * repair_CANT_SAFELY_VERIFY_SYNTAX may replace it with Ankur's trick,
   * depending on whether the platform also suffers from bugs that
   * would block it. See repair_CANT_SAFELY_VERIFY_SYNTAX for details.
   *
   * <p>To use Ankur's trick to check a FunctionBody rather than a
   * program, we use the trick in comment 7 at
   * https://code.google.com/p/google-caja/issues/detail?id=1616#c7
   * The criticism of it in comment 8 is blocked by Ankur's trick,
   * given the absence of the other bugs that
   * repair_CANT_SAFELY_VERIFY_SYNTAX checks in order to decide.
   *
   * <p>Testing once revealed that Crock's trick
   * (simpleVerifyStrictFunctionBody) executed over 100x faster on V8.
   */
  function verifyStrictFunctionBodyByEvalThrowing(funcBodySrc) {
    funcBodySrc = ''+funcBodySrc;
    try {
      unsafeEval('"use strict"; throw "not a SyntaxError 1";' +
                 '(function(){' + funcBodySrc +'\n});');
    } catch (outerErr) {
      if (outerErr === 'not a SyntaxError 1') {
        try {
          unsafeEval('throw "not a SyntaxError 2";' +
                     '(function(){{' + funcBodySrc +'\n}})');
        } catch (innerErr) {
          if (innerErr === 'not a SyntaxError 2') {
            // Presumably, if we got here, funcBodySrc parsed as a strict
            // function  body but was not executed, and {funcBodySrc}
            // parsed as a  non-strict function body but was not executed.
            // We try it again non-strict so that body level nested
            // function declarations will not get rejected. Accepting
            // them is beyond the ES5 spec, but is known to happen in
            // all implementations.
            return funcBodySrc;
          }
          if (innerErr instanceof SyntaxError) {
            // This case is likely symptomatic of an attack. But the
            // attack is thwarted and so need not be reported as
            // anything other than the SyntaxError it is.
            throw innerErr;
          }
        }
      }
      if (outerErr instanceof SyntaxError) {
        throw outerErr;
      }
    }
    throw new TypeError('Unexpected verification outcome');
  }

  var canMitigateSrcGotchas = typeof ses.mitigateSrcGotchas === 'function';

  /**
   * Due to https://code.google.com/p/v8/issues/detail?id=2728
   * we can't assume that SyntaxErrors are always early. If they're
   * not, then even Ankur's trick doesn't work, so we resort to a full
   * parse.
   *
   * <p>Only applicable if ses.mitigateSrcGotchas is available. To
   * accommodate constraints of Caja's initialization order, we do not
   * capture or invoke ses.mitigateSrcGotchas as the time repairES5 is
   * run. Rather we only test for its presence at repair time in order
   * to decide what verifier to use. We only use ses.mitigateSrcGotchas
   * later when we actually verify eval'ed code, and at that time we
   * use the current binding of ses.mitigateSrcGotchas.
   *
   * <p>Thus, clients (like Caja) that know they will be making a
   * real ses.mitigateSrcGotchas available after repair can
   * pre-install a placeholder function that, if accidentally invoked,
   * throws an error to complain that it was not replaced by the real
   * one. Then, sometime prior to the first verification, the client
   * should overwrite ses.mitigateSrcGotchas with the real one.
   */
  function verifyStrictFunctionBodyByParsing(funcBodySrc) {
    funcBodySrc = ''+funcBodySrc;
    var safeError;
    var newSrc;
    try {
      newSrc = ses.mitigateSrcGotchas(funcBodySrc,
                                      {parseFunctionBody: true},
                                      ses.logger);
    } catch (error) {
      // Shouldn't throw, but if it does, the exception is potentially
      // from a different context with an undefended prototype chain;
      // don't allow it to leak out.
      try {
        safeError = new Error(error.message);
      } catch (metaerror) {
        throw new Error(
          'Could not safely obtain error from mitigateSrcGotchas');
      }
      throw safeError;
    }

    // The following equality test is due to the peculiar API of
    // ses.mitigateSrcGotchas, which (TODO(jasvir)) should probably be
    // fixed instead. However, currently, since we're asking it only to
    // parse and not to rewrite, if the parse is successful it will
    // return its argument src string, which is fine.
    //
    // If the parse is not successful, ses.mitigateSrcGotchas
    // indicates the problem <i>only</i> by returning a string which,
    // if evaluated, would throw a SyntaxError with a non-informative
    // message. Since, in this case, these are the only possibilities,
    // we happen to be able to check for the error case by seeing
    // simply that the string returned is not the src string passed
    // in.
    if (newSrc !== funcBodySrc) {
      throw new SyntaxError('Failed to parse program');
    }
    return funcBodySrc;
  }

  /**
   * Where the "that" parameter represents a "this" that should have
   * been bound to "undefined" but may be bound to a global or
   * globaloid object.
   *
   * <p>The "desc" parameter is a string to describe the "that" if it
   * is something unexpected.
   */
  function testGlobalLeak(desc, that) {
    if (that === void 0) { return false; }
    if (that === global) { return true; }
    // objToString use here ok, because it only determines the quality
    // of diagnostic issued, and anyway runs only during SES
    // initialization before objToString could be spoofed.
    if (objToString.call(that) === '[object Window]') { return true; }
    return desc + ' leaked as: ' + that;
  }


  /**
   * Maps from standinName to an array mapping from arity to a cached
   * makeStandin function.
   *
   * Maps each blacklisted standinName to 'blacklisted'.
   */
  var standinMakerCache = EarlyStringMap();
  (function(){
     /**
      * See <a href=
      * "https://people.mozilla.org/~jorendorff/es6-draft.html"
      * >ES6 Draft Spec</a>. The blacklist may conservatively contain
      * names that would actually be safe. It may not omit names that
      * would be unsafe.
      */
     var blacklist = [
       // 11.6.2.1 Keywords
       'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
       'default', 'delete',
       'do', 'else', 'export', 'extends', 'finally', 'for', 'function',
       'if', 'import',
       'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this',
       'throw', 'try',
       'typeof', 'var', 'void', 'while', 'with', 'yield',

       // 11.6.2.2 Future Reserved Words
       'enum', 'await',
       'implements', 'interface', 'package', 'private', 'protected',
       'public', 'static',

       // 11.8 Literals
       'null', 'false', 'true',

       // 12.1.1 Static Semantics: Early Errors
       'arguments', 'eval',

       // 14.5.1 Static Semantics: Early Errors
       'let', 'constructor', 'prototype',

       // names used in makeStandinSrc
       'makeStandin', 'newF',

       // The following are almost certainly safe, but blacklisting
       // anyway just to be sure. Any of these might be unblacklisted in
       // the futre.

       // literal-like globals
       'NaN', 'Infinity', 'undefined',

       // $ is special in template strings
       '$',

       // contextually reserved or special in ES6
       'module', 'of', 'as', 'from',

       // expected to be contextually special in ES7
       'async', 'on'

       // 'get' and 'set' are contextually special in ES5, but despite
       // that we assume they are safe.
     ];

     for (var i = 0, len = blacklist.length; i < len; i++) {
       standinMakerCache.set(blacklist[i], 'blacklisted');
     }
   }());

  /**
   * Returns a makeStandin function which, given a function, returns a
   * function which has the same call and construct behavior, but
   * which has .length of arity, and, if known safe, a .name of
   * standinName.
   *
   * The makeStandin function returned by makeStandinMaker is not
   * generally fresh, to allow us to memoize these on standinName and
   * arity.
   */
  function makeStandinMaker(standinName, arity) {
    if (!/[a-zA-Z][a-zA-Z0-9]*/.test(standinName)) {
      standinName = 'standin';
    }
    var cacheLine = standinMakerCache.get(standinName);
    if (cacheLine === 'blacklisted') {
      standinName = 'standin';
      cacheLine = standinMakerCache.get(standinName);
    }
    if (!cacheLine) {
      cacheLine = [];
      standinMakerCache.set(standinName, cacheLine);
    }
    var result = cacheLine[arity];
    if (!result) {
      var args = [];
      for (var i = 0; i < arity; i++) {
        args.push('_' + i);
      }
      var makeStandinSrc = '(function makeStandin(newF) {\n' +
        '  "use strict";\n' +
        '  return function ' + standinName + '(' + args.join(',') + ') {\n' +
        '    return newF.apply(this, arguments);\n' +
        '  }\n' +
        '})';
      result = unsafeEval(makeStandinSrc);
      cacheLine[arity] = result;
    }
    return result;
  }

  /**
   * The function own property names that funcLike doesn't copy
   * in a generic manner from newFunc to the returned standin.
   */
  var exemptFuncProps = noFuncPoison ? ['name', 'length'] :
     ['name', 'length', 'caller', 'arguments'];

  /**
   * Given that newFunc represents a desired emulation of oldFunc
   * except for its .name and .length properties, engage in best
   * efforts to return a function like newFunc in which these
   * remaining issues are repaired, possibly by modifying newFunc in
   * place if possible, or possibly by wrapping it.
   *
   * <p>If we instead create and return a new standin function which
   * wraps newFunc, we also attempt to transfer any
   * non-exemptFuncProps (see above) from newFunc to the returned
   * standin.
   *
   * <p>We assume that after this call, the caller will use whatever we
   * return in lieu of accessing the newFunc they passed us directly,
   * which is why we allow funcLike to either modify newFunc in place,
   * or return a wrapper in which potentially mutable properties are
   * copied. If this assumption is false, then a mutation to one of
   * these properties on newFunc or the returned standin will not
   * necessarily be reflected in the other.
   *
   * <p>Note that ES5 does not specify a .name property on functions, and
   * IE11 (as of this writing) does not implement one, so this
   * implementation must be compatible with the absence of a .name
   * property on functions.
   */
  function funcLike(newFunc, oldFunc) {
    var name = ''+oldFunc.name;
    var arity = +oldFunc.length;
    // TODO(erights): On ES6 func.name starts configurable, so we
    // should try to modify newFunc.name in place if we can.
    // TODO(erights): On ES6 func.length starts configurable, so we
    // should try to modify newFunc.length in place if we can.
    if (''+newFunc.name === name && +newFunc.length === arity) {
      return newFunc;
    }

    var makeStandin = makeStandinMaker(name, arity);
    var standin = makeStandin(newFunc);

    var pnames = Object.getOwnPropertyNames(newFunc);
    pnames.forEach(function(pname) {
      if (exemptFuncProps.indexOf(pname) === -1) {
        Object.defineProperty(standin, pname,
                              Object.getOwnPropertyDescriptor(newFunc, pname));
      }
    });

    // The isFrozen and isSealed branches of the tests below seem
    // redundant with !isExtensible, since frozenness and sealedness
    // is, as of ES5, only the combination of extensibility + property
    // attributes. We do this anyway for two reasons: Because the
    // defineProperty loop above skips the exemptFuncProps. And in
    // case a future ES spec has frozenness or sealedness mean
    // something beyond merely extensibility + property attributes.
    if (Object.isFrozen(newFunc)) {
      Object.freeze(standin);
    } else if (Object.isSealed(newFunc)) {
      Object.seal(standin);
    } else if (!Object.isExtensible(newFunc)) {
      Object.preventExtensions(standin);
    }
    return standin;
  }
  ses.funcLike = funcLike;


  ////////////////////// Tests /////////////////////
  //
  // Each test is a function of no arguments that should not leave any
  // significant side effects, which tests for the presence of a
  // problem. It returns either
  // <ul>
  // <li>false, meaning that the problem does not seem to be present.
  // <li>true, meaning that the problem is present in a form that we expect.
  // <li>a non-empty string, meaning that there seems to be a related
  //     problem, but we're seeing a symptom different than what we
  //     expect. The string should describe the new symptom. It must
  //     be non-empty so that it is truthy.
  // </ul>
  // All the tests are run first to determine which corresponding
  // repairs to attempt. Then these repairs are run. Then all the
  // tests are rerun to see how they were effected by these repair
  // attempts. Finally, we report what happened.

  // Certain tests cannot operate without freezing primordial objects;
  // they must therefore be run in separate frames with fresh
  // primordials. Since the repairs will not have been performed in
  // those frames, we use these flags to have the tests explicitly
  // perform those repairs.
  //
  // TODO(kpreid): Figure out a better design for solving this problem.
  // For example, it would be good to generically run the relevant tests
  // after startSES has frozen everything and abort otherwise (this is
  // done as a special case for FREEZING_BREAKS_PROTOTYPES only).
  var repair_FREEZING_BREAKS_PROTOTYPES_wasApplied = false;
  var repair_TYPED_ARRAY_PROTOS_LOOK_UNFROZEN_wasApplied = false;

  /**
   * If {@code Object.getOwnPropertyNames} is missing, we consider
   * this to be an ES3 browser which is unsuitable for attempting to
   * run SES.
   *
   * <p>If {@code Object.getOwnPropertyNames} is missing, there is no
   * way to emulate it.
   */
  function test_MISSING_GETOWNPROPNAMES() {
    return !('getOwnPropertyNames' in Object);
  }

  /**
   * If you can, see Opera bug DSK-383293@bugs.opera.com.
   *
   * <p>On some Operas, the Object.prototype.__proto__ property is an
   * accessor property, but the property descriptor of that property
   * has a setter, i.e., {@code desc.set}, which throws a TypeError
   * when one tries to read it. Unfortunately, this creates
   * problems beyond our attempts at support.
   */
  function test_PROTO_SETTER_UNGETTABLE() {
    var desc = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__');
    if (!desc) { return false; }
    try {
      void desc.set; // yes, just reading it
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return ''+err;
    }
    return false;
  }

  /**
   * Do we seem to be in a browser environment?
   *
   * <p>Currently, we assume we are in a browser environment iff there
   * is a non-undefined <code>document</code> and
   * <code>document.createElement</code> is callable. We may use
   * better evidence in the future.
   */
  function isInBrowser() {
    return typeof document !== 'undefined' &&
      typeof document.createElement === 'function';
  }
  ses.isInBrowser = isInBrowser;

  /**
   * Create a new iframe and pass its 'window' object to the provided
   * callback.  If the environment is not a browser, return undefined
   * and do not call the callback.
   *
   * <p>inTestFrame assumes we are in a browser according to
   * <code>isInBrowser</code> above. If so, it creates an iframe,
   * makes it a child somewhere of the current document, calls the
   * callback, passing that iframe's window, and then removes the
   * iframe.
   *
   * <p>A typical callback will then create a
   * function within that other frame, to be used later to test
   * cross-frame operations. However, on IE10 on Windows, this iframe
   * removal may then prevent that created function from running at
   * that later time, with a "Error: Can't execute code from a freed
   * script" error.
   */
  function inTestFrame(callback) {
    if (!isInBrowser()) {
      return undefined;
    }
    var iframe = document.createElement('iframe');
    // Four choices for where to put the iframe seems like a lot. How
    // many of these have been, or even can be, tested? Can we kill
    // the ones we cannot test?
    var container = document.body || document.getElementsByTagName('head')[0] ||
        document.documentElement || document;
    container.appendChild(iframe);
    try {
      return callback(iframe.contentWindow);
    } finally {
      container.removeChild(iframe);
    }
  }

  /**
   * Problem visible in Chrome 27.0.1428.0 canary and 27.0.1453.15 beta:
   * freezing Object.prototype breaks Object.create inheritance.
   * https://code.google.com/p/v8/issues/detail?id=2565
   */
  function test_FREEZING_BREAKS_PROTOTYPES() {
    // This problem is sufficiently problematic that testing for it breaks the
    // frame under some circumstances, so we create another frame to test in.
    // (However, if we've already frozen Object.prototype, we can test in this
    // frame without side effects.)
    var testObject;
    if (Object.isFrozen(Object.prototype)) {
      testObject = Object;
    } else {
      testObject = inTestFrame(function(window) { return window.Object; });
      if (!testObject) { return false; }  // not in a web browser

      // Apply the repair which should fix the problem to the testing frame.
      // TODO(kpreid): Design a better architecture to handle cases like this
      // than one-off state flags.
      if (repair_FREEZING_BREAKS_PROTOTYPES_wasApplied) {
        // optional argument not supplied by normal repair process
        repair_FREEZING_BREAKS_PROTOTYPES(testObject);
      }
    }

    var a = new testObject();
    testObject.freeze(testObject.prototype);
    var b = testObject.create(a);  // will fail to set [[Prototype]] to a
    var proto = Object.getPrototypeOf(b);
    if (proto === a) {
      return false;
    } else if (proto === testObject.prototype) {
      return true;
    } else {
      return 'Prototype of created object is neither specified prototype nor ' +
          'Object.prototype';
    }
  }
  // exported so we can test post-freeze
  ses.kludge_test_FREEZING_BREAKS_PROTOTYPES = test_FREEZING_BREAKS_PROTOTYPES;

  /**
   * Problem visible in Chrome 29.0.1547.41 beta and 30.0.1587.2 canary.
   * Freezing Object.prototype while it is in a WeakMap breaks WeakMaps.
   * https://code.google.com/p/v8/issues/detail?id=2829
   */
  function test_FREEZING_BREAKS_WEAKMAP() {
    // This problem cannot be detected until Object.prototype is frozen, and
    // therefore must be tested in a separate frame. This is technically wrong,
    // because the problem can occur on iframe-less standalone browsers.
    //
    // Our repair is to delete WeakMap (and let WeakMap.js construct the
    // emulated WeakMap), which we can detect here and is obviously sufficient.
    if (typeof WeakMap === 'undefined') {
      // No WeakMap, or it has been "repaired", so no need
      return false;
    } else {
      var result = inTestFrame(function(window) {
        // trigger problem
        var wm1 = new window.WeakMap();
        wm1.set(window.Object.prototype, true);
        window.Object.freeze(window.Object.prototype);

        // test for problem
        var wm2 = new window.WeakMap();
        var o = window.Object.create(window.Object.prototype);
        wm2.set(o, true);
        return [wm2.get(o)];
      });
      if (!result || result[0] === true) {
        return false;
      } else if (result[0] === undefined) {
        return true;
      } else {
        return 'Unexpected WeakMap value: ' + result[0];
      }
    }
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=64250
   *
   * <p>No workaround attempted. Just reporting that this platform is
   * not SES-safe.
   */
  function test_GLOBAL_LEAKS_FROM_GLOBAL_FUNCTION_CALLS() {
    global.___global_test_function___ = function() { return this; };
    var that = ___global_test_function___();
    delete global.___global_test_function___;
    return testGlobalLeak('Global func "this"', that);
  }

  /**
   * Detects whether the most painful ES3 leak is still with us.
   */
  function test_GLOBAL_LEAKS_FROM_ANON_FUNCTION_CALLS() {
    var that = (function(){ return this; })();
    return testGlobalLeak('Anon func "this"', that);
  }

  var strictThis = this;

  /**
   *
   */
  function test_GLOBAL_LEAKS_FROM_STRICT_THIS() {
    return testGlobalLeak('Strict "this"', strictThis);
  }

  /**
   * Detects
   * https://bugs.webkit.org/show_bug.cgi?id=51097
   * https://bugs.webkit.org/show_bug.cgi?id=58338
   * https://code.google.com/p/v8/issues/detail?id=1437
   *
   * <p>No workaround attempted. Just reporting that this platform is
   * not SES-safe.
   */
  function test_GLOBAL_LEAKS_FROM_BUILTINS() {
    var v = {}.valueOf;
    var that = 'dummy';
    try {
      that = v();
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'valueOf() threw: ' + err;
    }
    if (that === void 0) {
      // Should report as a safe spec violation
      return false;
    }
    return testGlobalLeak('valueOf()', that);
  }

  /**
   *
   */
  function test_GLOBAL_LEAKS_FROM_GLOBALLY_CALLED_BUILTINS() {
    global.___global_valueOf_function___ = {}.valueOf;
    var that = 'dummy';
    try {
      that = ___global_valueOf_function___();
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'valueOf() threw: ' + err;
    } finally {
      delete global.___global_valueOf_function___;
    }
    if (that === void 0) {
      // Should report as a safe spec violation
      return false;
    }
    return testGlobalLeak('Global valueOf()', that);
  }

  /**
   * v8 bug: Array prototype methods operate on window if called as functions
   * (literally, not with .call()/.apply()).
   */
  function test_GLOBAL_LEAKS_FROM_ARRAY_METHODS() {
    var readCanary = {};
    var writeCanary = {};

    var saved = [];
    function save(name) {
      var opt_desc = Object.getOwnPropertyDescriptor(global, name);
      saved.push([name, opt_desc]);
      return !!opt_desc;
    }
    // Save the state of all properties that our test might mutate. We save
    // 'length' and all numeric-indexed properties which
    //   * have indexes less than global.length,
    //   * are numbered consecutively from other saved properties, or
    //   * are possibly mutated by our tests (the + 2).
    var lengthVal = global.length;
    var minSaveLength =
        ((typeof lengthVal === 'number' && isFinite(lengthVal))
            ? lengthVal : 0) + 2;
    save('length');
    var found = true;
    for (var i = 0; found || i < minSaveLength; i++) {
      found = save(i);
    }

    function subtest(name, args, failPredicate) {
      var method = Array.prototype[name];
      try {
        var result = method(args[0], args[1], args[2]);
      } catch (err) {
        if (err instanceof TypeError) { return false; }
        return 'Unexpected error from ' + name + ': ' + err;
      }
      if (failPredicate(result)) { return true; }
      return 'Unexpected result from ' + name + ': ' + result;
    }

    try {
      // Insert a dummy value to use.
      try {
        Array.prototype.push.call(global, readCanary);
      } catch (e) {
        // Fails on Firefox (which doesn't have this bug). Continue with the
        // test anyway just in case (but readCanary-using subtests will report
        // unexpected rather than true).
      }

      return (
        subtest('concat', [[]], function(result) {
            return result[0] === global; })
        || subtest('slice', [0], function(result) {
            return result[result.length-1] === readCanary; })
        || subtest('pop', [], function(result) {
            return result === readCanary; })
        || subtest('push', [writeCanary], function(result) {
            return global[global.length-1] === writeCanary; })
        || subtest('shift', [], function(result) { return true; })
        || subtest('slice', [], function(result) {
            return result.indexOf(readCanary) !== -1; })
        || subtest('splice', [0, 1, writeCanary], function(result) {
            return global[0] === writeCanary; })
        || subtest('unshift', [writeCanary], function(result) {
            return global[0] === writeCanary; })
      );
    } finally {
      saved.forEach(function(record) {
        var name = record[0];
        var oldDesc = record[1];
        if (oldDesc) {
          var newDesc = Object.getOwnPropertyDescriptor(global, name);
          if (!is(oldDesc.value, newDesc.value) ||
              oldDesc.writable !== newDesc.writable ||
              oldDesc.get !== newDesc.get ||
              oldDesc.set !== newDesc.set ||
              oldDesc.enumerable !== newDesc.enumerable) {
            // See the comments on freezeGlobalProp in startSES.js for
            // why we delete oldDesc.configurable. Given that we do,
            // the following two lines of code should succeed even if
            // the condition above is false. Thus, the condition
            // should not be needed. However, when running the Caja
            // regression tests, the testOk test tries to define a
            // global property to itself, which fails on FF 39 for
            // undiagnosed reasons.
            //
            // TODO(erights): Diagnose why testOk on FF 39 fails if we
            // do the following lines unconditionally, and report.
            delete oldDesc.configurable;
            Object.defineProperty(global, name, oldDesc);
          }
        } else {
          delete global[name];
        }
      });
    }
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=55736
   *
   * <p>As of this writing, the only major browser that does implement
   * Object.getOwnPropertyNames but not Object.freeze etc is the
   * released Safari 5 (JavaScriptCore). The Safari beta 5.0.4
   * (5533.20.27, r84622) already does implement freeze, which is why
   * this WebKit bug is listed as closed. When the released Safari has
   * this fix, we can retire this problem.
   *
   * <p>The repair is <b>not</b> safety preserving. The emulations it
   * installs if needed do not actually provide the safety that the
   * rest of SES relies on.
   */
  function test_MISSING_FREEZE_ETC() {
    return !('freeze' in Object);
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=1530
   *
   * <p>Detects whether the value of a function's "prototype" property
   * as seen by normal object operations might deviate from the value
   * as seem by the reflective {@code Object.getOwnPropertyDescriptor}
   */
  function test_FUNCTION_PROTOTYPE_DESCRIPTOR_LIES() {
    function foo() {}
    Object.defineProperty(foo, 'prototype', { value: {} });
    return foo.prototype !==
      Object.getOwnPropertyDescriptor(foo, 'prototype').value;
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=55537
   *
   * This bug is fixed on the latest Safari beta 5.0.5 (5533.21.1,
   * r88603). When the released Safari has this fix, we can retire
   * this problem.
   *
   * <p>The repair is safety preserving.
   */
  function test_MISSING_CALLEE_DESCRIPTOR() {
    function foo(){}
    if (Object.getOwnPropertyNames(foo).indexOf('callee') < 0) { return false; }
    if (foo.hasOwnProperty('callee')) {
      return 'Empty strict function has own callee';
    }
    return true;
  }

  /**
   * A strict delete should either succeed, returning true, or it
   * should fail by throwing a TypeError. Under no circumstances
   * should a strict delete return false.
   *
   * <p>This case occurs on IE10preview2.
   */
  function test_STRICT_DELETE_RETURNS_FALSE() {
    if (!RegExp.hasOwnProperty('rightContext')) { return false; }
    var deleted;
    try {
      deleted = delete RegExp.rightContext;
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Deletion failed with: ' + err;
    }
    if (deleted) { return false; }
    return true;
  }

  /**
   * Detects https://bugzilla.mozilla.org/show_bug.cgi?id=591846
   * as applied to the RegExp constructor.
   *
   * <p>Note that Mozilla lists this bug as closed. But reading that
   * bug thread clarifies that is partially because the code in {@code
   * repair_REGEXP_CANT_BE_NEUTERED} enables us to work around the
   * non-configurability of the RegExp statics.
   */
  function test_REGEXP_CANT_BE_NEUTERED() {
    if (!RegExp.hasOwnProperty('leftContext')) { return false; }
    var deleted;
    try {
      deleted = delete RegExp.leftContext;
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return 'Deletion failed with: ' + err;
    }
    if (!RegExp.hasOwnProperty('leftContext')) { return false; }
    if (deleted) {
      return 'Deletion of RegExp.leftContext did not succeed.';
    } else {
      // This case happens on IE10preview2, as demonstrated by
      // test_STRICT_DELETE_RETURNS_FALSE.
      return true;
    }
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=1393
   *
   * <p>The repair is safety preserving.
   */
  function test_REGEXP_TEST_EXEC_UNSAFE() {
    (/foo/).test('xfoox');
    var match = new RegExp('(.|\r|\n)*','').exec()[0];
    if (match === 'undefined') { return false; }
    if (match === 'xfoox') { return true; }
    return 'regExp.exec() does not match against "undefined".';
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=26382
   *
   * <p>As of this writing, the only major browser that does implement
   * Object.getOwnPropertyNames but not Function.prototype.bind is
   * Safari 5 (JavaScriptCore), including the current Safari beta
   * 5.0.4 (5533.20.27, r84622).
   *
   * <p>The repair is safety preserving. But see
   * https://bugs.webkit.org/show_bug.cgi?id=26382#c25 for why this
   * repair cannot faithfully implement the specified semantics.
   *
   * <p>See also https://bugs.webkit.org/show_bug.cgi?id=42371
   */
  function test_MISSING_BIND() {
    return !('bind' in Function.prototype);
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=892
   *
   * <p>This tests whether the built-in bind method violates the spec
   * by calling the original using its current .apply method rather
   * than the internal [[Call]] method. The workaround is the same as
   * for test_MISSING_BIND -- to replace the built-in bind with one
   * written in JavaScript. This introduces a different bug though: As
   * https://bugs.webkit.org/show_bug.cgi?id=26382#c29 explains, a
   * bind written in JavaScript cannot emulate the specified currying
   * over the construct behavior, and so fails to enable a var-args
   * {@code new} operation.
   */
  function test_BIND_CALLS_APPLY() {
    if (!('bind' in Function.prototype)) { return false; }
    var applyCalled = false;
    function foo() { return [].slice.call(arguments,0).join(','); }
    foo.apply = function fakeApply(self, args) {
      applyCalled = true;
      return Function.prototype.apply.call(this, self, args);
    };
    var b = foo.bind(33,44);
    var answer = b(55,66);
    if (applyCalled) { return true; }
    if (answer === '44,55,66') { return false; }
    return 'Bind test returned "' + answer + '" instead of "44,55,66".';
  }

  /**
   * Demonstrates the point made by comment 29
   * https://bugs.webkit.org/show_bug.cgi?id=26382#c29
   *
   * <p>Tests whether Function.prototype.bind curries over
   * construction ({@code new}) behavior. A built-in bind should. A
   * bind emulation written in ES5 can't.
   */
  function test_BIND_CANT_CURRY_NEW() {
    function construct(f, args) {
      var bound = Function.prototype.bind.apply(f, [null].concat(args));
      return new bound();
    }
    var d;
    try {
      d = construct(Date, [1957, 4, 27]);
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return 'Curries construction failed with: ' + err;
    }
    if (typeof d === 'string') { return true; } // Opera
    if (isBuiltinDate(d)) { return false; }
    return 'Unexpected alleged Date: ' + d;
  }

  /**
   * Detects https://code.google.com/p/google-caja/issues/detail?id=1362
   *
   * <p>This is an unfortunate oversight in the ES5 spec: Even if
   * Date.prototype is frozen, it is still defined to be a Date, and
   * so has mutable state in internal properties that can be mutated
   * by the primordial mutation methods on Date.prototype, such as
   * {@code Date.prototype.setFullYear}.
   *
   * <p>The repair is safety preserving.
   */
  function test_MUTABLE_DATE_PROTO() {
    try {
      Date.prototype.setFullYear(1957);
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Mutating Date.prototype failed with: ' + err;
    }
    var v = Date.prototype.getFullYear();
    Date.prototype.setFullYear(NaN); // hopefully undoes the damage
    if (v !== v && typeof v === 'number') {
      // NaN indicates we're probably ok.
      // TODO(erights) Should we report this as a symptom anyway, so
      // that we get the repair which gives us a reliable TypeError?
      return false;
    }
    if (v === 1957) { return true; }
    return 'Mutating Date.prototype did not throw';
  }

  /**
   * Detects https://bugzilla.mozilla.org/show_bug.cgi?id=656828
   *
   * <p>A bug in the current FF6.0a1 implementation: Even if
   * WeakMap.prototype is frozen, it is still defined to be a WeakMap,
   * and so has mutable state in internal properties that can be
   * mutated by the primordial mutation methods on WeakMap.prototype,
   * such as {@code WeakMap.prototype.set}.
   *
   * <p>The repair is safety preserving.
   *
   * <p>TODO(erights): Update the ES spec page to reflect the current
   * agreement with Mozilla.
   */
  function test_MUTABLE_WEAKMAP_PROTO() {
    if (typeof WeakMap !== 'function') { return false; }
    var x = {};
    try {
      WeakMap.prototype.set(x, 86);
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Mutating WeakMap.prototype failed with: ' + err;
    }
    var v = WeakMap.prototype.get(x);
    // Since x cannot escape, there's no observable damage to undo.
    if (v === 86) { return true; }
    return 'Mutating WeakMap.prototype did not throw';
  }

  /**
   * As of ES6, for all the builtin constructors that make a
   * particular type of exotic object, except Function, Array, Number,
   * Boolean, and String, that constructor.prototype must be a plain
   * object rather than that kind of exotic object.
   */
  function test_DATE_PROTO_IS_DATE() {
    return isBuiltinDate(Date.prototype);
  }

  /**
   * As of ES6, for all the builtin constructors except
   * (except Function, Array, Number, Boolean, and String),
   * that make a particular type of exotic object, that
   * constructor.prototype must be a plain object rather than that
   * kind of exotic object.
   */
  function test_WEAKMAP_PROTO_IS_WEAKMAP() {
    if (typeof WeakMap !== 'function') { return false; }
    return isBuiltinWeakMap(WeakMap.prototype);
  }

  /**
   * As of ES6, for all the builtin constructors except
   * (except Function, Array, Number, Boolean, and String),
   * that make a particular type of exotic object, that
   * constructor.prototype must be a plain object rather than that
   * kind of exotic object.
   */
  function test_REGEXP_PROTO_IS_REGEXP() {
    return isBuiltinRegExp(RegExp.prototype);
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=1447
   *
   * <p>This bug is fixed as of V8 r8258 bleeding-edge, but is not yet
   * available in the latest dev-channel Chrome (13.0.782.15 dev).
   *
   * <p>Unfortunately, an ES5 strict method wrapper cannot emulate
   * absence of a [[Construct]] behavior, as specified for the Chapter
   * 15 built-in methods. The installed wrapper relies on {@code
   * Function.prototype.apply}, as inherited by original, obeying its
   * contract.
   *
   * <p>The repair is safety preserving but non-transparent, in that
   * the real forEach is frozen even in the success case, since we
   * have to freeze it in order to test for this failure. We could
   * repair this non-transparency by replacing it with a transparent
   * wrapper (as https://codereview.appspot.com/5278046/ does), but
   * since the SES use of this will freeze it anyway and the
   * indirection is costly, we choose not to for now.
   */
  function test_NEED_TO_WRAP_FOREACH() {
    if (!('freeze' in Object)) {
      // Object.freeze is still absent on released Android and would
      // cause a bogus bug detection in the following try/catch code.
      return false;
    }
    if (Array.prototype.forEach !== builtInForEach) {
      // If it is already wrapped, we are confident the problem does
      // not occur, and we need to skip the test to avoid freezing the
      // wrapper.
      return false;
    }
    try {
      ['z'].forEach(function(){ Object.freeze(Array.prototype.forEach); });
      return false;
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return 'freezing forEach failed with ' + err;
    }
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=2273
   *
   * A strict mode function should receive a non-coerced 'this'
   * value. That is, in strict mode, if 'this' is a primitive, it
   * should not be boxed
   */
  function test_FOREACH_COERCES_THISOBJ() {
    var needsWrapping = true;
    [1].forEach(function(){ needsWrapping = ('string' != typeof this); }, 'f');
    return needsWrapping;
  }

  /**
   * <p>Sometimes, when trying to freeze an object containing an
   * accessor property with a getter but no setter, Chrome <= 17 fails
   * with <blockquote>Uncaught TypeError: Cannot set property ident___
   * of #<Object> which has only a getter</blockquote>.
   */
  function test_NEEDS_DUMMY_SETTER() {
    if (typeof navigator === 'undefined') { return false; }
    var ChromeMajorVersionPattern = (/Chrome\/(\d*)\./);
    var match = ChromeMajorVersionPattern.exec(navigator.userAgent);
    if (!match) { return false; }
    var ver = +match[1];
    return ver <= 17;
  }

  /**
   * Detects https://code.google.com/p/chromium/issues/detail?id=94666
   */
  function test_FORM_GETTERS_DISAPPEAR() {
    function getter() { return 'gotten'; }

    if (!isInBrowser()) {
      return false;
    }
    var f = document.createElement('form');
    try {
      Object.defineProperty(f, 'foo', {
        get: getter,
        set: void 0
      });
    } catch (err) {
      // Happens on Safari 5.0.2 on IPad2.
      return 'defining accessor on form failed with: ' + err;
    }
    var desc = Object.getOwnPropertyDescriptor(f, 'foo');
    if (desc.get === getter) { return false; }
    if (desc.get === void 0) { return true; }
    return 'Getter became ' + desc.get;
  }

  /**
   * Detects https://bugzilla.mozilla.org/show_bug.cgi?id=637994
   *
   * <p>On Firefox 4 an inherited non-configurable accessor property
   * appears to be an own property of all objects which inherit this
   * accessor property. This is fixed as of Forefox Nightly 7.0a1
   * (2011-06-21).
   *
   * <p>Our workaround wraps hasOwnProperty, getOwnPropertyNames, and
   * getOwnPropertyDescriptor to heuristically decide when an accessor
   * property looks like it is apparently own because of this bug, and
   * suppress reporting its existence.
   *
   * <p>However, it is not feasible to likewise wrap JSON.stringify,
   * and this bug will cause JSON.stringify to be misled by inherited
   * enumerable non-configurable accessor properties. To prevent this,
   * we wrap defineProperty, freeze, and seal to prevent the creation
   * of <i>enumerable</i> non-configurable accessor properties on
   * those platforms with this bug.
   *
   * <p>A little known fact about JavaScript is that {@code
   * Object.prototype.propertyIsEnumerable} actually tests whether a
   * property is both own and enumerable. Assuming that our wrapping
   * of defineProperty, freeze, and seal prevents the occurrence of an
   * enumerable non-configurable accessor property, it should also
   * prevent the occurrence of this bug for any enumerable property,
   * and so we do not need to wrap propertyIsEnumerable.
   *
   * <p>The repair seems to be safety preserving, but the issues are
   * delicate and not well understood.
   */
  function test_ACCESSORS_INHERIT_AS_OWN() {
    var base = {};
    var derived = Object.create(base);
    function getter() { return 'gotten'; }
    Object.defineProperty(base, 'foo', { get: getter });
    if (!derived.hasOwnProperty('foo') &&
        Object.getOwnPropertyDescriptor(derived, 'foo') === void 0 &&
        Object.getOwnPropertyNames(derived).indexOf('foo') < 0) {
      return false;
    }
    if (!derived.hasOwnProperty('foo') ||
        Object.getOwnPropertyDescriptor(derived, 'foo').get !== getter ||
        Object.getOwnPropertyNames(derived).indexOf('foo') < 0) {
      return 'Accessor properties partially inherit as own properties.';
    }
    Object.defineProperty(base, 'bar', { get: getter, configurable: true });
    if (!derived.hasOwnProperty('bar') &&
        Object.getOwnPropertyDescriptor(derived, 'bar') === void 0 &&
        Object.getOwnPropertyNames(derived).indexOf('bar') < 0) {
      return true;
    }
    return 'Accessor properties inherit as own even if configurable.';
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=1360
   *
   * Our workaround wraps {@code sort} to wrap the comparefn.
   */
  function test_SORT_LEAKS_GLOBAL() {
    var that = 'dummy';
    [2,3].sort(function(x,y) { that = this; return x - y; });
    if (that === void 0) { return false; }
    if (that === global) { return true; }
    return 'sort called comparefn with "this" === ' + that;
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=1360
   *
   * <p>Our workaround wraps {@code replace} to wrap the replaceValue
   * if it's a function.
   */
  function test_REPLACE_LEAKS_GLOBAL() {
    var that = 'dummy';
    function capture() { that = this; return 'y';}
    'x'.replace(/x/, capture);
    if (that === void 0) { return false; }
    if (that === capture) {
      // This case happens on IE10preview2. See
      // https://connect.microsoft.com/IE/feedback/details/685928/
      //   bad-this-binding-for-callback-in-string-prototype-replace
      // TODO(erights): When this happens, the problem.description is
      // wrong.
      return true;
    }
    if (that === global) { return true; }
    return 'Replace called replaceValue function with "this" === ' + that;
  }

  /**
   * Detects
   * https://connect.microsoft.com/IE/feedback/details/
   *   685436/getownpropertydescriptor-on-strict-caller-throws
   *
   * <p>Object.getOwnPropertyDescriptor must work even on poisoned
   * "caller" properties.
   */
  function test_CANT_GOPD_CALLER() {
    var desc = null;
    try {
      desc = Object.getOwnPropertyDescriptor(function(){}, 'caller');
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return 'getOwnPropertyDescriptor failed with: ' + err;
    }
    if (desc &&
        typeof desc.get === 'function' &&
        typeof desc.set === 'function' &&
        !desc.configurable) {
      return false;
    }
    if (desc &&
        desc.value === null &&
        !desc.writable &&
        !desc.configurable) {
      // Seen in IE9. Harmless by itself
      return false;
    }
    if (desc === void 0 && noFuncPoison) { return false; }
    if (desc === void 0) { return true; }
    return 'getOwnPropertyDesciptor returned unexpected caller descriptor';
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=63398
   *
   * <p>A strict function's caller should be poisoned only in a way
   * equivalent to an accessor property with a throwing getter and
   * setter.
   *
   * <p>Seen on Safari 5.0.6 through WebKit Nightly r93670
   */
  function test_CANT_HASOWNPROPERTY_CALLER() {
    var answer = void 0;
    try {
      answer = function(){}.hasOwnProperty('caller');
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return 'hasOwnProperty failed with: ' + err;
    }
    return !answer && !noFuncPoison;
  }

  /**
   * Protect an 'in' with a try/catch to workaround a bug in Safari
   * WebKit Nightly Version 5.0.5 (5533.21.1, r89741).
   *
   * <p>See https://bugs.webkit.org/show_bug.cgi?id=63398
   *
   * <p>Notes: We're seeing exactly
   * <blockquote>
   *   New symptom (c): ('caller' in &lt;a bound function&gt;) threw:
   *   TypeError: Cannot access caller property of a strict mode
   *   function<br>
   *   New symptom (c): ('arguments' in &lt;a bound function&gt;)
   *   threw: TypeError: Can't access arguments object of a strict
   *   mode function
   * </blockquote>
   * which means we're skipping both the catch and the finally in
   * {@code has} while hitting the catch in {@code has2}. Further, if
   * we remove one of these finally clauses (forget which) and rerun
   * the example, if we're under the debugger the browser crashes. If
   * we're not, then the TypeError escapes both catches.
   */
  function has(base, name, baseDesc) {
    var result = void 0;
    var finallySkipped = true;
    try {
      result = name in base;
    } catch (err) {
      logger.error('New symptom (a): (\'' +
                   name + '\' in <' + baseDesc + '>) threw: ', err);
      // treat this as a safe absence
      result = false;
      return false;
    } finally {
      finallySkipped = false;
      if (result === void 0) {
        logger.error('New symptom (b): (\'' +
                     name + '\' in <' + baseDesc + '>) failed');
      }
    }
    if (finallySkipped) {
      logger.error('New symptom (e): (\'' +
                   name + '\' in <' + baseDesc +
                   '>) inner finally skipped');
    }
    return !!result;
  }

  function has2(base, name, baseDesc) {
    var result = void 0;
    var finallySkipped = true;
    try {
      result = has(base, name, baseDesc);
    } catch (err) {
      logger.error('New symptom (c): (\'' +
                   name + '\' in <' + baseDesc + '>) threw: ', err);
      // treat this as a safe absence
      result = false;
      return false;
    } finally {
      finallySkipped = false;
      if (result === void 0) {
        logger.error('New symptom (d): (\'' +
                     name + '\' in <' + baseDesc + '>) failed');
      }
    }
    if (finallySkipped) {
      logger.error('New symptom (f): (\'' +
                   name + '\' in <' + baseDesc +
                   '>) outer finally skipped');
    }
    return !!result;
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=63398
   *
   * <p>If this reports a problem in the absence of "New symptom (a)",
   * it means the error thrown by the "in" in {@code has} is skipping
   * past the first layer of "catch" surrounding that "in". This is in
   * fact what we're currently seeing on Safari WebKit Nightly Version
   * 5.0.5 (5533.21.1, r91108).
   */
  function test_CANT_IN_CALLER() {
    var answer = void 0;
    try {
      answer = has2(function(){}, 'caller', 'strict_function');
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return '("caller" in strict_func) failed with: ' + err;
    } finally {}
    if (answer) { return false; }
    if (noFuncPoison) { return false; }
    return '("caller" in strict_func) was false.';
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=63398
   *
   * <p>If this reports a problem in the absence of "New symptom (a)",
   * it means the error thrown by the "in" in {@code has} is skipping
   * past the first layer of "catch" surrounding that "in". This is in
   * fact what we're currently seeing on Safari WebKit Nightly Version
   * 5.0.5 (5533.21.1, r91108).
   */
  function test_CANT_IN_ARGUMENTS() {
    var answer = void 0;
    try {
      answer = has2(function(){}, 'arguments', 'strict_function');
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return '("arguments" in strict_func) failed with: ' + err;
    } finally {}
    if (answer) { return false; }
    if (noFuncPoison) { return false; }
    return '("arguments" in strict_func) was false.';
  }

  /**
   * Detects whether strict function violate caller anonymity.
   */
  function test_STRICT_CALLER_NOT_POISONED() {
    if (!has2(strictFnSpecimen, 'caller', 'a strict function')) {
      return false;
    }
    function foo(m) { return m.caller; }
    // using Function so it'll be non-strict
    var testfn = Function('m', 'f', 'return m([m], f)[0];');
    var caller;
    try {
      caller = testfn(strictFnSpecimen, foo);
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Strict "caller" failed with: ' + err;
    }
    if (testfn === caller) {
      // Seen on IE 9
      return true;
    }
    if (caller === void 0 && noFuncPoison) { return false; }
    return 'Unexpected "caller": ' + caller;
  }

  /**
   * Detects whether strict functions are encapsulated.
   */
  function test_STRICT_ARGUMENTS_NOT_POISONED() {
    if (!has2(strictFnSpecimen, 'arguments', 'a strict function')) {
      return false;
    }
    function foo(m) { return m.arguments; }
    // using Function so it'll be non-strict
    var testfn = Function('m', 'f', 'return m([m], f)[0];');
    var args;
    try {
      args = testfn(strictFnSpecimen, foo);
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Strict "arguments" failed with: ' + err;
    }
    if (args[1] === foo) {
      // Seen on IE 9
      return true;
    }
    if (args === void 0 && noFuncPoison) { return false; }
    return 'Unexpected arguments: ' + arguments;
  }

  /**
   * Detects https://bugzilla.mozilla.org/show_bug.cgi?id=591846 as
   * applied to "caller"
   */
  function test_BUILTIN_LEAKS_CALLER() {
    if (!has2(builtInMapMethod, 'caller', 'a builtin')) { return false; }
    function foo(m) { return m.caller; }
    // using Function so it'll be non-strict
    var testfn = Function('a', 'f', 'return a.map(f)[0];');
    var a = [builtInMapMethod];
    a.map = builtInMapMethod;
    var caller;
    try {
      caller = testfn(a, foo);
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Built-in "caller" failed with: ' + err;
    }
    if (null === caller || void 0 === caller) { return false; }
    if (testfn === caller) { return true; }
    return 'Unexpected "caller": ' + caller;
  }

  /**
   * Detects https://bugzilla.mozilla.org/show_bug.cgi?id=591846 as
   * applied to "arguments"
   */
  function test_BUILTIN_LEAKS_ARGUMENTS() {
    if (!has2(builtInMapMethod, 'arguments', 'a builtin')) { return false; }
    function foo(m) { return m.arguments; }
    // using Function so it'll be non-strict
    var testfn = Function('a', 'f', 'return a.map(f)[0];');
    var a = [builtInMapMethod];
    a.map = builtInMapMethod;
    var args;
    try {
      args = testfn(a, foo);
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Built-in "arguments" failed with: ' + err;
    }
    if (args === void 0 || args === null) { return false; }
    return true;
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=893
   */
  function test_BOUND_FUNCTION_LEAKS_CALLER() {
    if (!('bind' in Function.prototype)) { return false; }
    function foo() { return bar.caller; }
    var bar = foo.bind({});
    if (!has2(bar, 'caller', 'a bound function')) { return false; }
    // using Function so it'll be non-strict
    var testfn = Function('b', 'return b();');
    var caller;
    try {
      caller = testfn(bar);
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Bound function "caller" failed with: ' + err;
    }
    if (caller === void 0 || caller === null) { return false; }
    if (caller === testfn) { return true; }
    return 'Unexpected "caller": ' + caller;
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=893
   */
  function test_BOUND_FUNCTION_LEAKS_ARGUMENTS() {
    if (!('bind' in Function.prototype)) { return false; }
    function foo() { return bar.arguments; }
    var bar = foo.bind({});
    if (!has2(bar, 'arguments', 'a bound function')) { return false; }
    // using Function so it'll be non-strict
    var testfn = Function('b', 'return b();');
    var args;
    try {
      args = testfn(bar);
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Bound function "arguments" failed with: ' + err;
    }
    if (args === void 0 || args === null) { return false; }
    return true;
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=70207
   *
   * <p>After deleting a built-in, the problem is that
   * getOwnPropertyNames still lists the name as present, but it seems
   * absent in all other ways.
   */
  function test_DELETED_BUILTINS_IN_OWN_NAMES() {
    if (!('__defineSetter__' in Object.prototype)) { return false; }
    var desc = Object.getOwnPropertyDescriptor(Object.prototype,
                                               '__defineSetter__');
    try {
      try {
        delete Object.prototype.__defineSetter__;
      } catch (err1) {
        return false;
      }
      var names = Object.getOwnPropertyNames(Object.prototype);
      if (names.indexOf('__defineSetter__') === -1) { return false; }
      if ('__defineSetter__' in Object.prototype) {
        // If it's still there, it bounced back. Which is still a
        // problem, but not the problem we're testing for here.
        return false;
      }
      return true;
    } finally {
      Object.defineProperty(Object.prototype, '__defineSetter__', desc);
    }
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=1769
   */
  function test_GETOWNPROPDESC_OF_ITS_OWN_CALLER_FAILS() {
    try {
      Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor,
                                      'caller');
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return 'getOwnPropertyDescriptor threw: ' + err;
    }
    return false;
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=621
   *
   */
  function test_JSON_PARSE_PROTO_CONFUSION() {
    var x;
    try {
      x = JSON.parse('{"__proto__":[]}');
    } catch (err) {
      if (err instanceof TypeError) {
        // We consider it acceptable to fail this case with a
        // TypeError, as our repair below will cause it to do.
        return false;
      }
      return 'JSON.parse failed with: ' + err;
    }
    if (Object.getPrototypeOf(x) !== Object.prototype) { return true; }
    if (Array.isArray(x.__proto__)) { return false; }
    return 'JSON.parse did not set "__proto__" as a regular property';
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=65832
   *
   * <p>On a non-extensible object, it must not be possible to change
   * its internal [[Prototype]] property, i.e., which object it
   * inherits from.
   *
   * TODO(erights): investigate the following:
   * At https://goo.gl/ycCmo Mike Stay says
   * <blockquote>
   * Kevin notes in domado.js that on some versions of FF, event
   * objects switch prototypes when moving between frames. You should
   * probably check out their behavior around freezing and sealing.
   * </blockquote>
   * But I couldn't find it.
   */
  function test_PROTO_NOT_FROZEN() {
    if (!('freeze' in Object)) {
      // Object.freeze and its ilk (including preventExtensions) are
      // still absent on released Android and would
      // cause a bogus bug detection in the following try/catch code.
      return false;
    }
    var x = Object.preventExtensions({});
    if (x.__proto__ === void 0 && !('__proto__' in x)) { return false; }
    var y = {};
    try {
      x.__proto__ = y;
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Mutating __proto__ failed with: ' + err;
    }
    if (y.isPrototypeOf(x)) { return true; }
    return 'Mutating __proto__ neither failed nor succeeded';
  }

  /**
   * Like test_PROTO_NOT_FROZEN but using defineProperty rather than
   * assignment.
   */
  function test_PROTO_REDEFINABLE() {
    if (!('freeze' in Object)) {
      // Object.freeze and its ilk (including preventExtensions) are
      // still absent on released Android and would
      // cause a bogus bug detection in the following try/catch code.
      return false;
    }
    var x = Object.preventExtensions({});
    if (x.__proto__ === void 0 && !('__proto__' in x)) { return false; }
    var y = {};
    try {
      Object.defineProperty(x, '__proto__', { value: y });
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Defining __proto__ failed with: ' + err;
    }
    // If x.__proto__ has changed but is not equal to y,
    // we deal with that in the next test.
    return (x.__proto__ === y);
  }


  /**
   * Some versions of v8 fail silently when attempting to assign to __proto__
   */
  function test_DEFINING_READ_ONLY_PROTO_FAILS_SILENTLY() {
    if (!('freeze' in Object)) {
      // Object.freeze and its ilk (including preventExtensions) are
      // still absent on released Android and would
      // cause a bogus bug detection in the following try/catch code.
      return false;
    }
    var x = Object.preventExtensions({});
    if (x.__proto__ === void 0 && !('__proto__' in x)) { return false; }
    var y = {};
    try {
      Object.defineProperty(x, '__proto__', { value: y });
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Defining __proto__ failed with: ' + err;
    }
    if (x.__proto__ === Object.prototype) {
      return true;
    }
    return 'Read-only proto was changed in a strange way.';
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=1624
   * regarding variables.
   *
   * <p>Both a direct strict eval operator and an indirect strict eval
   * function must not leak top level declarations in the string being
   * evaluated into their containing context.
   */
  function test_STRICT_EVAL_LEAKS_GLOBAL_VARS() {
    unsafeEval('"use strict"; var ___global_test_variable___ = 88;');
    if ('___global_test_variable___' in global) {
      delete global.___global_test_variable___;
      return true;
    }
    return false;
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=1624
   * regarding functions
   *
   * <p>Both a direct strict eval operator and an indirect strict eval
   * function must not leak top level declarations in the string being
   * evaluated into their containing context.
   */
  function test_STRICT_EVAL_LEAKS_GLOBAL_FUNCS() {
    unsafeEval('"use strict"; function ___global_test_func___(){}');
    if ('___global_test_func___' in global) {
      delete global.___global_test_func___;
      return true;
    }
    return false;
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=2396
   *
   * <p>Commenting out the eval does the right thing.  Only fails in
   * non-strict mode.
   */
  function test_EVAL_BREAKS_MASKING() {
    var x;
    x = (function a() {
      function a() {}
      eval('');
      return a;
    });
    // x() should be the internal function a(), not itself
    return x() === x;
  }


  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=1645
   */
  function test_PARSEINT_STILL_PARSING_OCTAL() {
    var n = parseInt('010');
    if (n === 10) { return false; }
    if (n === 8)  { return true; }
    return 'parseInt("010") returned ' + n;
  }

  /**
   * Detects https://bugzilla.mozilla.org/show_bug.cgi?id=695577
   *
   * <p>When E4X syntax is accepted in strict code, then without
   * parsing, we cannot prevent untrusted code from expressing E4X
   * literals and so obtaining access to shared E4X prototypes,
   * despite the absence of these prototypes from our whitelist. While
   * https://bugzilla.mozilla.org/show_bug.cgi?id=695579 is also
   * open, we cannot even repair the situation, leading to unpluggable
   * capability leaks. However, we do not test for this additional
   * problem, since E4X is such a can of worms that 695577 is adequate
   * by itself for us to judge this platform to be insecurable without
   * parsing.
   */
  function test_STRICT_E4X_LITERALS_ALLOWED() {
    var x;
    try {
      x = eval('"use strict";(<foo/>);');
    } catch (err) {
      if (err instanceof SyntaxError) { return false; }
      return 'E4X test failed with: ' + err;
    }
    if (x !== void 0) { return true; }
    return 'E4X literal expression had no value';
  }

  /**
   * Detects whether assignment can override an inherited
   * non-writable, non-configurable data property.
   *
   * <p>According to ES5.1, assignment should not be able to do so,
   * which is unfortunate for SES, as the tamperProof function must
   * kludge expensively to ensure that legacy assignments that don't
   * violate best practices continue to work. Ironically, on platforms
   * in which this bug is present, tamperProof can just cheaply
   * wrap Object.freeze.
   */
  function test_ASSIGN_CAN_OVERRIDE_FROZEN() {
    var x = Object.freeze({foo: 88});
    var y = Object.create(x);
    try {
      y.foo = 99;
    } catch (err) {
      if (err instanceof TypeError) { return false; }
      return 'Override failed with: ' + err;
    }
    if (y.foo === 99) { return true; }
    if (y.foo === 88) { return 'Override failed silently'; }
    return 'Unexpected override outcome: ' + y.foo;
  }

  /**
   * Detects https://code.google.com/p/v8/issues/detail?id=2779
   *
   * A function which is optimized by V8 can mutate frozen properties using
   * increment/decrement operators.
   */
  function test_INCREMENT_IGNORES_FROZEN() {
    function optimizedFun(o, i) {
      if (i == 3) {
        // the count does need to be this high
        for (var j = 0; j < 100000; j++) {}
      }
      o.a++;
      // The bug also applies to --, +=, and -=, but we would have to have
      // separate runs for each one to check them.
    }
    var x = Object.freeze({a: 88});
    var threw = true;
    // multiple executions are needed
    for (var i = 0; i < 4; i++) {
      try {
        optimizedFun(x, i);
        threw = false;
      } catch (err) {
        if (!(err instanceof TypeError)) {
          return 'Increment failed with: ' + err;
        }
      }
    }
    if (x.a === 89) {
      // expected mutation result
      return true;
    }
    if (x.a === 88) {
      if (threw) {
        return false;
      } else {
        return 'Increment failed silently';
      }
    }
    return 'Unexpected increment outcome: ' + JSON.stringify(x);
  }

  /**
   * Detects whether calling pop on a frozen array can modify the array.
   * See https://bugs.webkit.org/show_bug.cgi?id=75788
   */
  function test_POP_IGNORES_FROZEN() {
    var x = [1,2];
    Object.freeze(x);
    try {
      x.pop();
    } catch (e) {
      if (x.length !== 2) { return 'Unexpected modification of frozen array'; }
      if (x[0] === 1 && x[1] === 2) { return false; }
    }
    if (x.length === 1 && x[0] === 1 && x[1] === 2) {
      // Behavior seen on Opera 12.10 mobile and 12.15
      return true;
    }
    if (x.length === 1 && x[0] === 1 && !('1' in x)) {
      // Behavior seen on Safari 5.1.9 (6534.59.8)
      return true;
    }
    if (x.length !== 2) {
      return 'Unexpected silent modification of frozen array';
    }
    return (x[0] !== 1 || x[1] !== 2);
  }


  /**
   * Detects whether calling sort on a frozen array can modify the array.
   * See https://code.google.com/p/v8/issues/detail?id=2419
   */
  function test_SORT_IGNORES_FROZEN() {
    var x = [2,1];
    Object.freeze(x);
    try {
      x.sort();
    } catch (e) {
      if (x.length !== 2) { return 'Unexpected modification of frozen array'; }
      if (x[0] === 2 && x[1] === 1) { return false; }
    }
    if (x.length !== 2) {
      return 'Unexpected silent modification of frozen array';
    }
    return (x[0] !== 2 || x[1] !== 1);
  }

  /**
   * Detects whether calling push on a sealed array can modify the array.
   * See https://code.google.com/p/v8/issues/detail?id=2412
   */
  function test_PUSH_IGNORES_SEALED() {
    var x = [1,2];
    Object.seal(x);
    try {
      x.push(3);
    } catch (e) {
      if (x.length !== 2) { return 'Unexpected modification of frozen array'; }
      if (x[0] === 1 && x[1] === 2) { return false; }
    }
    return (x.length !== 2 || x[0] !== 1 || x[1] !== 2);
  }

  /**
   * Detects whether calling push on a frozen array throws an error.
   */
  function test_PUSH_DOES_NOT_THROW_ON_FROZEN_ARRAY() {
    var x = [1,2];
    Object.freeze(x);
    try {
      x.push(3);
    } catch (e) {
      return false;
    }
    return true;
  }

  /**
   * Detects whether calling push on a frozen array can modify the array.
   */
  function test_PUSH_IGNORES_FROZEN() {
    var x = [1,2];
    Object.freeze(x);
    try {
      x.push(3);
    } catch (e) {
      if (x.length !== 2) { return 'Unexpected modification of frozen array'; }
      if (x[0] === 1 && x[1] === 2) { return false; }
    }
    return (x.length !== 2 || x[0] !== 1 || x[1] !== 2);
  }

  var unrepairedArrayPush = Array.prototype.push;
  /**
   * Detects the array-length aspect of
   * <a href="https://code.google.com/p/v8/issues/detail?id=2711">v8 bug 2711
   * </a>. We detect this specifically because repairing it avoids the need
   * to patch .push() at performance cost.
   */
  function test_ARRAY_LENGTH_MUTABLE() {
    for (var i = 0; i < 2; i++) {  // Only shows up the second time
      var x = [1,2];
      Object.freeze(x);
      try {
        // Call the unrepaired Array.prototype.push which is known to trigger
        // the internal mutability bug (whereas e.g. repair_PUSH_IGNORES_SEALED
        // would hide it). This is being used as a test mechanism and not
        // because the bug is in push.
        unrepairedArrayPush.call(x, 3);
      } catch (e) {
        // Don't care whether or not push throws; if it does not mutate and
        // does not throw, that's a bug but not this bug.
      }
      if (x.length === 3 && x[0] === 1 && x[1] === 2 && x[2] === 3) {
        // Behavior seen on Safari 5.1.9 (6534.59.8)
        return true;
      }
      if (x[0] !== 1 || x[1] !== 2 || x[2] !== undefined) {
        return 'Unexpected modification to elements of array';
      }
      if (x.length === 3) { return true; }
      if (x.length !== 2) {
        return 'Unexpected modification to length of array';
      }
    }
    return false;
  }

  /**
   * In some browsers, assigning to array length can delete
   * non-configurable properties.
   * https://bugzilla.mozilla.org/show_bug.cgi?id=590690
   * TODO(felix8a): file bug for chrome
   */
  function test_ARRAYS_DELETE_NONCONFIGURABLE() {
    var x = [];
    Object.defineProperty(x, 0, { value: 3, configurable: false });
    try {
      x.length = 0;
    } catch (e) {}
    return x.length !== 1 || x[0] !== 3;
  }

  /**
   * In some versions of Chrome, extending an array can
   * modify a read-only length property.
   * https://code.google.com/p/v8/issues/detail?id=2379
   */
  function test_ARRAYS_MODIFY_READONLY() {
    var x = [];
    try {
      Object.defineProperty(x, 'length', {value: 0, writable: false});
      x[0] = 1;
    } catch(e) {}
    return x.length !== 0 || x[0] !== void 0;
  }

  /**
   *
   */
  function test_CANT_REDEFINE_NAN_TO_ITSELF() {
    var descNaN = Object.getOwnPropertyDescriptor(global, 'NaN');
    try {
      Object.defineProperty(global, 'NaN', descNaN);
    } catch (err) {
      if (err instanceof TypeError) { return true; }
      return 'defineProperty of NaN failed with: ' + err;
    }
    return false;
  }

  /**
   * In Firefox 15+, the [[Extensible]] flag is not correctly readable or
   * settable from code originating from a different frame than the object.
   *
   * This test is written in terms of Object.freeze because that's what we care
   * about the correct operation of.
   */
  function test_FREEZE_IS_FRAME_DEPENDENT() {
    // This test is extensive because it needs to verify not just the behavior
    // of the known problem, but that our repair for it was adequate.

    var other = inTestFrame(function(window) { return {
      Object: window.Object,
      mutator: window.Function('o', 'o.x = 1;')
    }; });
    if (!other) { return false; }

    var frozenInOtherFrame = other.Object();
    var freezeSucceeded;
    try {
      Object.freeze(frozenInOtherFrame);
      freezeSucceeded = true;
    } catch (e) {
      freezeSucceeded = false;
    }
    if (Object.isFrozen(frozenInOtherFrame) &&
        other.Object.isFrozen(frozenInOtherFrame) &&
        freezeSucceeded) {
      // desired behavior
    } else if (!Object.isFrozen(frozenInOtherFrame) &&
        !other.Object.isFrozen(frozenInOtherFrame) &&
        !freezeSucceeded) {
      // adequate repair
    } else if (Object.isFrozen(frozenInOtherFrame) &&
        !other.Object.isFrozen(frozenInOtherFrame) &&
        freezeSucceeded) {
      // expected problem
      return true;
    } else {
      return 'Other freeze failure: ' + Object.isFrozen(frozenInOtherFrame) +
          other.Object.isFrozen(frozenInOtherFrame) + freezeSucceeded;
    }

    var frozenInThisFrame = Object.freeze({});
    // This is another sign of the problem, but we can't repair it and will live
    // with it.
    //if (Object.isFrozen(frozenInThisFrame) &&
    //    other.Object.isFrozen(frozenInThisFrame)) {
    //  // desired behavior
    //} else if (!Object.isFrozen(frozenInThisFrame)) {
    //  return 'Object.isFrozen is broken in this frame';
    //} else if (!other.Object.isFrozen(frozenInThisFrame)) {
    //  return true;
    //}
    other.mutator(frozenInThisFrame);
    if (frozenInThisFrame.x !== undefined) {
      return 'mutable in other frame';
    }

    return false;  // all tests passed
  }

  /**
   * These are all the own properties that appear on Error instances
   * on various ES5 platforms as of this writing.
   *
   * <p>Due to browser bugs, some of these are absent from
   * getOwnPropertyNames (gopn). TODO(erights): File bugs with various
   * browser makers for any own properties that we know to be present
   * but not reported by gopn.
   *
   * <p>TODO(erights): do intelligence with the various browser
   * implementors to find out what other properties are provided by
   * their implementation but absent from gopn, whether on Errors or
   * anything else. Every one of these are potentially fatal to our
   * security until we can examine these.
   *
   * <p>The source form is a list rather than a map so that we can list a
   * name like "message" for each browser section we think it goes in.
   *
   * <p>We thank the following people, projects, and websites for
   * providing some useful intelligence of what property names we
   * should suspect:<ul>
   * <li><a href="http://stacktracejs.com">stacktracejs.com</a>
   * <li>TODO(erights): find message on es-discuss list re
   * "   stack". credit author.
   * </ul>
   */
  var errorInstanceWhitelist = [
    // at least Chrome 16
    'arguments',
    'message',
    'stack',
    'type',

    // at least FF 9
    'fileName',
    'lineNumber',
    'message',
    'stack',
    // at least FF 21
    'columnNumber',

    // at least Safari, WebKit 5.1
    'line',
    'message',
    'sourceId',
    'sourceURL',

    // at least Safari 6.0.5 webkit nightly (8536.30.1, 538+)
    'message',
    'stack',
    'line',
    'column',

    // at least IE 10 preview 2
    'description',
    'message',
    'number',

    // at least Opera 11.60
    'message',
    'stack',
    'stacktrace'
  ];
  var errorInstanceWhiteMap = new EarlyStringMap();
  strictForEachFn(errorInstanceWhitelist, function(name) {
    errorInstanceWhiteMap.set(name, true);
  });

  // Properties specifically invisible-until-touched to gOPN on Firefox, but
  // otherwise harmless.
  var errorInstanceKnownInvisibleList = [
    'message',
    'fileName',
    'lineNumber',
    'columnNumber',
    'stack'
  ];

  // Property names to check for unexpected behavior.
  var errorInstanceBlacklist = [
    // seen in a Firebug on FF
    'category',
    'context',
    'href',
    'lineNo',
    'msgId',
    'source',
    'trace',
    'correctSourcePoint',
    'correctWithStackTrace',
    'getSourceLine',
    'resetSource'
  ];

  /**
   * Do Error instances on those platform carry own properties that we
   * haven't yet examined and determined to be SES-safe?
   *
   * <p>A new property should only be added to the
   * errorInstanceWhitelist after inspecting the consequences of that
   * property to determine that it does not compromise SES safety. If
   * some platform maker does add an Error own property that does
   * compromise SES safety, that might be a severe problem, if we
   * can't find a way to deny untrusted code access to that property.
   */
  function test_UNEXPECTED_ERROR_PROPERTIES() {
    var errs = [new Error('e1')];
    try { null.foo = 3; } catch (err) { errs.push(err); }
    var result = false;

    strictForEachFn(errs, function(err) {
      strictForEachFn(Object.getOwnPropertyNames(err), function(name) {
         if (!errorInstanceWhiteMap.has(name)) {
           result = 'Unexpected error instance property: ' + name;
           // would be good to terminate early
         }
      });
    });
    return result;
  }

  /**
   * On Firefox 14+ (and probably earlier), error instances have magical
   * properties that do not appear in getOwnPropertyNames until you refer
   * to the property.  We have been informed of the specific list at
   * <https://bugzilla.mozilla.org/show_bug.cgi?id=724768#c12>.
   */
  function test_ERRORS_HAVE_INVISIBLE_PROPERTIES() {
    var gopn = Object.getOwnPropertyNames;
    var gopd = Object.getOwnPropertyDescriptor;

    var checks = errorInstanceWhitelist.concat(errorInstanceBlacklist);
    var needRepair = false;

    var errors = [new Error('e1')];
    try { null.foo = 3; } catch (err) { errors.push(err); }
    for (var i = 0; i < errors.length; i++) {
      var err = errors[i];
      var found = new EarlyStringMap();
      strictForEachFn(gopn(err), function (prop) {
        found.set(prop, true);
      });
      var j, prop;
      // Check known props
      for (j = 0; j < errorInstanceKnownInvisibleList.length; j++) {
        prop = errorInstanceKnownInvisibleList[j];
        if (gopd(err, prop) && !found.get(prop)) {
          needRepair = true;
          found.set(prop, true);  // don't treat as new symptom
        }
      }
      // Check for new symptoms
      for (j = 0; j < checks.length; j++) {
        prop = checks[j];
        if (gopd(err, prop) && !found.get(prop)) {
          return 'Unexpectedly invisible Error property: ' + prop;
        }
      }
    }
    return needRepair;
  }

  /**
   * A strict getter is not supposed to coerce 'this'. However, some
   * platforms coerce primitive types into their corresponding wrapper
   * objects.
   */
  function test_STRICT_GETTER_BOXES() {
    Object.defineProperty(Number.prototype, '___test_prop___', {
      get: function() { return this; },
      set: void 0,
      enumerable: false,
      configurable: true
    });
    var v = null;
    try {
      v = (3).___test_prop___;
      if (v === 3) { return false; }
      if (v instanceof Number) { return true; }
      return 'unexpected boxing test result: ' + v;
    } finally {
      delete Number.prototype.___test_prop___;
    }
  }

  /**
   * A non-strict getter is supposed to coerce its 'this' in the same
   * manner as non-strict functions. However, on some platforms, they
   * fail to coerce primitive types into their corresponding wrapper
   * objects.
   */
  function test_NON_STRICT_GETTER_DOESNT_BOX() {
    Object.defineProperty(Number.prototype, '___test_prop___', {
      get: new Function('return this;'),
      set: void 0,
      enumerable: false,
      configurable: true
    });
    var v = null;
    try {
      v = (3).___test_prop___;
      if (v instanceof Number) { return false; }
      if (v === 3) { return true; }
      return 'unexpected non-boxing test result: ' + v;
    } finally {
      delete Number.prototype.___test_prop___;
    }
  }

  /**
   * A non-configurable __proto__ property appearing even on
   * Object.create(null). It may still be a bug if it were configurable, but
   * we only care about the case where we cannot replace it.
   */
  function test_NONCONFIGURABLE_OWN_PROTO() {
    try {
      var o = Object.create(null);
    } catch (e) {
      if (e.message === NO_CREATE_NULL) {
        // result of repair_FREEZING_BREAKS_PROTOTYPES
        return false;
      } else {
        throw e;
      }
    }
    var desc = Object.getOwnPropertyDescriptor(o, '__proto__');
    if (desc === undefined) { return false; }
    if (desc.configurable) { return false; }
    if (desc.value === null && desc.configurable === false) {
      // the problematic-for-us case, known to occur in Chrome 25.0.1364.172
      return true;
    }
    return 'Unexpected __proto__ own property descriptor, enumerable: ' +
      desc.enumerable + ', value: ' + desc.value;
  }

  /**
   * %ThrowTypeError% is not unique (even after whatever cleanup was
   * already done during the noFuncPoison testing above).
   */
  function test_THROWTYPEERROR_NOT_UNIQUE() {
    var tte = unsafeIntrinsics.ThrowTypeError;
    if (typeof tte !== 'function') {
      return 'Unexpected %ThrowTypeError%: ' + tte;
    }
    var others = [];
    var sourcesOfTTE = [
      [Function.prototype, 'Function.prototype', ['caller', 'arguments']],
      [builtInMapMethod, 'builtin function', ['caller', 'arguments']],
      [strictArguments, 'strict function', ['caller', 'arguments']],
      [sloppyArguments, 'sloppy function', ['caller', 'arguments']],
      [strictArguments(), 'strict arguments', ['caller', 'callee']],
      [sloppyArguments(), 'sloppy arguments', ['caller', 'callee']]
    ];
    if (strictArgumentsGenerator) {
      var strictGeneratedArgs = strictArgumentsGenerator().next().value;
      sourcesOfTTE.push(
        [strictArgumentsGenerator, 'strict generator', ['caller', 'arguments']],
        [strictGeneratedArgs, 'strict generated arguments',
         ['caller', 'callee']]);
    }
    var Generator = ses.earlyUndeniables['%Generator%'];
    if (Generator) {
      sourcesOfTTE.push([Generator, '%Generator%', ['caller', 'arguments']]);
    }
    var GeneratorFunction = unsafeIntrinsics.GeneratorFunction;
    if (GeneratorFunction) {
      sourcesOfTTE.push([GeneratorFunction, '%GeneratorFunction%',
                    ['caller', 'arguments']]);
    }

    strictForEachFn(sourcesOfTTE, function(sourceOfTTE) {
      var base = sourceOfTTE[0];
      var where = sourceOfTTE[1];
      var names = sourceOfTTE[2];
      strictForEachFn(names, function(name) {
        var desc = Object.getOwnPropertyDescriptor(base, name);
        if (!desc) { return; }
        strictForEachFn(['get', 'set'], function (attr) {
          var otherTTE = desc[attr];
          if (!otherTTE || otherTTE === tte) { return; }
          others.push(where + ' ' + attr + ' ' + name);
        });
      });
    });
    if (others.length === 0) { return false; }
    return 'Multiple %ThrowTypeError%s: ' + others.join(', ');
  }

  /**
   * %ThrowTypeError% is extensible or has modifiable properties.
   */
  function test_THROWTYPEERROR_UNFROZEN() {
    return !Object.isFrozen(unsafeIntrinsics.ThrowTypeError);
  }

  /**
   * %ThrowTypeError% has properties which the spec gives to other function
   * objects but not %ThrowTypeError%.
   *
   * We don't check for arbitrary properties because they might be extensions
   * for all function objects, which we don't particularly want to complain
   * about (and will delete via whitelisting).
   */
  function test_THROWTYPEERROR_PROPERTIES() {
    var tte = unsafeIntrinsics.ThrowTypeError;
    return !!Object.getOwnPropertyDescriptor(tte, 'prototype') ||
        !!Object.getOwnPropertyDescriptor(tte, 'arguments') ||
        !!Object.getOwnPropertyDescriptor(tte, 'caller');
  }

  /**
   * See https://code.google.com/p/v8/issues/detail?id=2728
   * and https://code.google.com/p/google-caja/issues/detail?id=1616
   */
  function test_SYNTAX_ERRORS_ARENT_ALWAYS_EARLY() {
    try {
      unsafeEval('throw "not a SyntaxError"; return;');
    } catch (err) {
      if (err === 'not a SyntaxError') {
        return true;
      } else if (err instanceof SyntaxError) {
        return false;
      }
      return 'Unexpected error: ' + err;
    }
    return 'Invalid text parsed';
  }

  /**
   * See https://code.google.com/p/google-caja/issues/detail?id=1616
   */
  function test_CANT_SAFELY_VERIFY_SYNTAX() {
    try {
      // See explanation above the call to ses.verifyStrictFunctionBody
      // below.
      Function('/*', '*/){');
    } catch (err) {
      if (err instanceof SyntaxError) { return false; }
      return 'Unexpected error: ' + err;
    }
    if (ses.verifyStrictFunctionBody === simpleVerifyStrictFunctionBody) {
      return true;
    }

    if (ses.verifyStrictFunctionBody === verifyStrictFunctionBodyByParsing) {
      // This might not yet be the real one. If
      // repair_CANT_SAFELY_VERIFY_SYNTAX decides to verify by
      // parsing, then we're just going to assume here that it is safe
      // since we might not yet have access to the real parser to test.
      return false;
    }

    try {
      ses.CANT_SAFELY_VERIFY_SYNTAX_canary = false;
      try {
        // This test, when tried with simpleVerifyStrictFunctionBody even on
        // Safari 6.0.4 WebKit Nightly r151081 (the latest at the time
        // of this writing) causes the *browser* to crash.
        //
        // So to avoid crashing the browser, we first check if the
        // Function constructor itself suffers from the same
        // underlying problem, by making a similar check that does not
        // crash the Safari browser. See
        // https://bugs.webkit.org/show_bug.cgi?id=106160
        // If this check shows that the underlying problem is absent
        // then there's no problem. If it is present and no repair to
        // ses.verifyStrictFunctionBody has yet been attempted, then we
        // know we have the problem even without the following check.
        //
        // Even on Safari, if the repair has been attempted, then we
        // do fall through to the following check, since it will no
        // longer crash the browser.
        ses.verifyStrictFunctionBody(
          '}), (ses.CANT_SAFELY_VERIFY_SYNTAX_canary = true), (function(){');
      } catch (err) {
        if (err instanceof SyntaxError) { return false; }
        return 'Unexpected error: ' + err;
      }
      if (ses.CANT_SAFELY_VERIFY_SYNTAX_canary === true) { return true; }
      return 'Unexpected verification failure';
    } finally {
      delete ses.CANT_SAFELY_VERIFY_SYNTAX_canary;
    }
  }

  var typedArrayNames = [
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float32Array',
    'Float64Array'
  ];

  function test_TYPED_ARRAYS_THROW_DOMEXCEPTION() {
    if (global.DataView === undefined) { return false; }
    if (global.DOMException === undefined) { return false; }
    function subtest(f) {
      try {
        f();
      } catch (e) {
        if (e instanceof DOMException) {
          return true;
        } else if (e instanceof Error && !(e instanceof DOMException)) {
          return false;
        } else {
          return 'Exception from ' + f + ' of unexpected type: ' + e;
        }
      }
      return f + ' did not throw';
    };
    return [
      function() { new global.Int8Array(1).set(new global.Int8Array(), 10); },
      function() { new global.DataView(new global.ArrayBuffer(1)).getInt8(-1); }
    ].some(subtest);
  }

  /**
   * Observed on Safari 6.0.5 (8536.30.1): frozen typed array prototypes report
   * their properties as writable.
   */
  function test_TYPED_ARRAY_PROTOS_LOOK_UNFROZEN() {
    // note: cannot test without frames
    return inTestFrame(function(window) {
      // Apply the repair which should fix the problem to the testing frame.
      // TODO(kpreid): Design a better architecture to handle cases like this
      // than one-off state flags.
      if (repair_TYPED_ARRAY_PROTOS_LOOK_UNFROZEN_wasApplied) {
        // optional argument not supplied by normal repair process
        repair_TYPED_ARRAY_PROTOS_LOOK_UNFROZEN(window);
      }

      var fail = false;
      typedArrayNames.forEach(function(ctorName) {
        var ctor = window[ctorName];
        if (!ctor) { return; }
        var proto = ctor.prototype;

        window.Object.freeze(proto);
        if (!window.Object.isFrozen(proto)) {
          fail = true;
          return;
        }

        window.Object.getOwnPropertyNames(proto, function(prop) {
          if (typeof fail === 'string') { return; }

          // check attributes
          var desc = window.Object.getOwnPropertyDescriptor(proto, prop);
          if (!desc.configurable && desc.writable) {
            fail = true;
          } else if (!desc.configurable && !desc.writable) {
            // correct result
          } else {
            fail = 'Unexpected property attributes for ' + ctorName + '.' +
                prop;
            return;
          }

          // check actual writability
          try { proto[prop] = 9; } catch (e) {}
          if (proto[prop] !== desc.value) {
            fail = 'Unexpected actual writability of ' + ctorName + '.' + prop;
            return;
          }
        });
      });
      return fail;
    });
  }

  /**
   * Detects
   * https://connect.microsoft.com/IE/feedback/details/811124/ie11-javascript-function-scoping-is-weird-with-respect-to-functions-and-try-catch
   * in strict code.
   *
   * A strict nested function definition should either be a syntax
   * error, as
   * http://wiki.ecmascript.org/doku.php?id=conventions:recommendations_for_implementors
   * recommends, or it should stay local to its block, as ES6
   * specifies. Within that block, an assignment to that function's
   * name should assign to the block-local variable defined by that
   * function.
   */
  function test_NESTED_STRICT_FUNCTIONS_LEAK() {
    try {
      return unsafeEval(
          '(function() {\n' +
          '  "use strict";\n' +
          '  var a = function good() { return false; };\n' +
          '  try {\n' +
          '    function a() { return true; }' +
          '    a = function blah() {\n' +
          '      return "Assignment skipped nested function definition";\n' +
          '    };\n' +
          '  } catch (x) {}\n' +
          '  return a();\n' +
          '})();\n');
    } catch (err) {
      if (err instanceof SyntaxError) {
        return false;
      }
      return 'Unexpected error from strict nested function: ' + err;
    }
  }

  /**
   * Bug in IE versions 9 to 11 (current as of this writing):
   * http://webreflection.blogspot.co.uk/2014/04/all-ie-objects-are-broken.html
   *
   * An object which is a product of Object.create(somePrototype), and which has
   * only numeric-named properties, will in some ways appear to not have those
   * properties.
   */
  function test_NUMERIC_PROPERTIES_INVISIBLE() {
    var o1 = Object.create({}, {0: {value: 1}});  // normal
    var o2 = Object.create({});                   // demonstrates bug
    o2[0] = 1;

    if (o1.hasOwnProperty('0') && o1[0] === 1 &&
        o2.hasOwnProperty('0') && o2[0] === 1) {
      return false;
    } else if (o1.hasOwnProperty('0') && o1[0] === 1 &&
               !o2.hasOwnProperty('0') && o2[0] === 1) {
      return true;
    } else {
      return 'Unexpected results from numeric property on created object';
    }
  }

  /**
   * Tests for https://code.google.com/p/v8/issues/detail?id=3334
   * which reports that setting a function's prototype with
   * defineProperty can update its descriptor without updating the
   * actual value when also changing writable from true to false.
   */
  function test_DEFINE_PROPERTY_CONFUSES_FUNC_PROTO() {
    function bar() {}
    var oldBarPrototype = bar.prototype;
    Object.defineProperty(bar, 'prototype', {value: 2, writable: false});
    var desc = Object.getOwnPropertyDescriptor(bar, 'prototype');
    if (desc.value !== 2) {
        return 'Unexpected descriptor from setting a function\'s ' +
          'protptype with defineProperty: ' + JSON.stringify(desc);
    }
    if (bar.prototype === 2) {
      return false;
    } else if (typeof bar.prototype === 'object') {
      if (bar.prototype === oldBarPrototype) {
        return true;
      } else {
        return 'Unexpected prototype identity from setting a function\'s ' +
          'prototype with defineProperty.';
      }
    } else {
      return 'Unexpected result of setting a function\'s prototype ' +
        'with defineProperty: ' + typeof bar.prototype;
    }
  }

  /**
   * In ES6, the constructor property of the %Generator% intrinsic
   * initially points at the unsafe %GeneratorFunction% intrinsic. This
   * property is supposed to have attributes
   * { [[Writable]]: false, [[Enumerable]]: false, [[Configurable]]: true }
   * Prior to 2/19/2015, on v8 it had attributes
   * { [[Writable]]: false, [[Enumerable]]: false, [[Configurable]]: false }
   * making it impossible to change the property's value.
   *
   * <p>Since the original %GeneratorFunction% intrinsic, like the
   * global Function constructor, accepts a function body which it
   * executes in the global scope, it would be reachable by any
   * generator. Without parsing, we would not be able to prevent
   * the following expression
   * <pre>
   * (function*(){}).constructor('yield window;')().next().value
   * </pre>
   * from providing the genuine global window object of that realm.
   */
  function test_GENERATORFUNCTION_CANNOT_BE_DENIED() {
    var gopd = Object.getOwnPropertyDescriptor;
    var getProto = Object.getPrototypeOf;

    var UnsafeGeneratorFunction = unsafeIntrinsics.GeneratorFunction;
    if (!UnsafeGeneratorFunction) { return false; }
    var Generator = ses.earlyUndeniables['%Generator%'];
    if (!(Generator &&
          Generator.constructor === UnsafeGeneratorFunction &&
          UnsafeGeneratorFunction.prototype === Generator &&
          getProto(UnsafeGeneratorFunction) === UnsafeFunction &&
          getProto(Generator) === Function.prototype)) {
      return 'Unexpected primordial Generator arrangement';
    }
    var desc = gopd(Generator, 'constructor');
    return desc.writable === false && desc.configurable === false;
  }

  /**
   * ES6 introduces a new "import" special form syntax, which imports
   * access to modules that we cannot currently control. Therefore, if
   * we cannot prevent use of the "import" syntax, we lose
   * isolation. Fortunately, the "import" syntax can only legally
   * occur with modules, not within the text that the original eval,
   * Function, or %GeneratorFunction% would accept. Since untrusted
   * code enters a SES environment only through these, we should be
   * safe.
   *
   * <p>This test checks that this assumption indeed holds for the
   * current platform.
   */
  function test_IMPORT_CAN_BE_EVALLED() {
    // From Table 40 at
    // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-source-text-module-records
    // The following test will actually attempt to eval the following
    // strings, so it is important that there not be strings here that
    // can do damage if this eval succeeds during SES
    // initialization. This is before any untrusted code runs in this
    // realm, so we assume that no module named __noModWithThisName__
    // is yet importable.
    var importExamples = [
        'import v from "__noModWithThisName__";',
        'import * as ns from "__noModWithThisName__";',
        'import {x} from "__noModWithThisName__";',
        'import {x as v} from "__noModWithThisName__";',
        'import "__noModWithThisName__";'];
    var evallers = [unsafeEval, UnsafeFunction];
    if (unsafeIntrinsics.GeneratorFunction) {
      evallers.push(unsafeIntrinsics.GeneratorFunction);
    }
    for (var i = 0; i < importExamples.length; i++) {
      for (var j = 0; j < evallers.length; j++) {
        try {
          evallers[j](importExamples[i]);
          return true;
        } catch (ex) {
          if (!(ex instanceof SyntaxError)) {
            return 'unexpected "' + importExamples[i] + '" failure: ' + ex;
          }
        }
      }
    }
    return false;
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=141865
   *
   * <p>On Safari 7.0.5 (9537.77.4), the getter of the
   * Object.prototype.__proto__ property, if applied to undefined,
   * acts like a sloppy function would, coercing the undefined to the
   * global object and returning the global object's [[Prototype]].
   */
  function test_UNDERBAR_PROTO_GETTER_USES_GLOBAL() {
    var gopd = Object.getOwnPropertyDescriptor;
    var getProto = Object.getPrototypeOf;

    var desc = gopd(Object.prototype, '__proto__');
    if (!desc) { return false; }
    var getter = desc.get;
    if (!getter) { return false; }
    var globalProto = void 0;
    try {
      globalProto = getter();
    } catch (ex) {
      if (ex instanceof TypeError && globalProto === void 0) {
          return false;
      }
      return 'unexpected error: ' + ex;
    }
    if (getProto(global) === globalProto) { return true; }
    return 'unexpected global.__proto__: ' + globalProto;
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=141865
   *
   * <p>On Safari 7.0.5 (9537.77.4), the setter of the
   * Object.prototype.__proto__ property, if applied to undefined,
   * acts like a sloppy function would, coercing the undefined to the
   * global object and setting its [[Prototype]].
   */
  function test_UNDERBAR_PROTO_SETTER_USES_GLOBAL() {
    var gopd = Object.getOwnPropertyDescriptor;
    var getProto = Object.getPrototypeOf;

    var desc = gopd(Object.prototype, '__proto__');
    if (!desc) { return false; }
    var setter = desc.set;
    if (!setter) { return false; }
    var globalProto = getProto(global);
    // Just insert an intermediate object into the prototype chain of the
    // global object, so this realm is left in a usable state.
    var splicedProto = Object.create(globalProto);
    try {
      setter(splicedProto);
    } catch (ex) {
      if (ex instanceof TypeError && getProto(global) === globalProto) {
        return false;
      }
      return 'unexpected error: ' + ex;
    }
    if (getProto(global) === splicedProto) { return true; }
    return 'unexpected global.__proto__: ' + getProto(global);
  }

  /**
   * Detects https://bugs.webkit.org/show_bug.cgi?id=141878
   *
   * <p>On Safari 7.0.5 (9537.77.4), throwing a frozen object results
   * in it becoming unfrozen and  several properties being added to
   * it: 'line', 'column', 'sourceURL' (not always), and 'stack'. The
   * big security hole is due to 'stack', which is added as a
   * writable configurable property. Although initialized to a string,
   * one can assign an arbitrary object to it, opening a capability
   * leak.
   */
  function test_THROWING_THAWS_FROZEN_OBJECT() {
    var o = Object.freeze([1, 2]);
    if (!Object.isFrozen(o)) {
      return 'Unexpected spontaneous thaw';
    }
    var oldNames = Object.getOwnPropertyNames(o);
    try {
      throw o;
    } catch (e) {
      if (e !== o) {
        return 'What was thrown is not what was caught';
      }
      if (Object.isFrozen(e)) {
        // In the bug we're testing for, Object.isFrozen(e) is false,
        // which is dealt with below this if-statement.
        // If Object.isFrozen(e) is true, presumably this platform
        // does not have the bug. Before concluding that we're safe
        // from this bug (returning false) the rest of this case does
        // a bit of sanity checking to make sure that other symptoms
        // of this bug are absent.
        var newNames = Object.getOwnPropertyNames(o);
        if (oldNames.length !== newNames.length) {
          return 'Throwing changed properties to: ' + newNames;
        }
        return false;
      }
      var oldStack = e.stack;
      var capLeak = {};
      try {
        e.stack = capLeak;
      } catch (err) {
        if (e.stack === oldStack) {
          throw 'Unexpected failure to leak: ' + err;
        }
      }
      if (e.stack === capLeak) { return true; }
    }
    return 'Unexpected result of throwing frozen object';
  }


  /**
   * Tests for https://bugzilla.mozilla.org/show_bug.cgi?id=1125389
   * which is a Firefox specific bug that enables one to extend
   * objects that were supposedly made non-extensible.
   */
  function test_NON_EXTENSIBLES_EXTENSIBLE() {
    var someVar = 33;
    var a = void 0;
    function Obj() {
      this.x = 0;
      Object.preventExtensions(this);
    }
    var i = 0;
    function test() {
      var A = new Obj();
      a = A;
      while (i < 2000) {
        i++;
        if (Object.isExtensible(A)) {
          return;
        }
      }
      A.length1 = someVar;
    }
    try {
      test();
    } catch (e) {
      if (e instanceof TypeError && i === 2000) {
        return false;
      } else {
        return 'Unexpected error: ' + e;
      }
    }
    try {
      a.randomProperty = someVar;
      a.length1 = someVar;
    } catch (e2) {
      return 'Extending failed: ' + e2;
    }
    if (a.randomProperty !== someVar || a.length1 !== someVar) {
      return 'Did not extend correctly: ' + a;
    }
    return true;
  }

  function test_MISSING_GET_OWN_PROPERTY_DESCRIPTORS() {
    return !('getOwnPropertyDescriptors' in Object);
  }


  ////////////////////// Repairs /////////////////////
  //
  // Each repair_NAME function exists primarily to repair the problem
  // indicated by the corresponding test_NAME function. But other test
  // failures can still trigger a given repair.


  var call = Function.prototype.call;
  var apply = Function.prototype.apply;

  var hop = Object.prototype.hasOwnProperty;
  var slice = Array.prototype.slice;
  var concat = Array.prototype.concat;
  var getPrototypeOf = Object.getPrototypeOf;
  var unsafeDefProp = Object.defineProperty;
  var isExtensible = Object.isExtensible;

  /*
   * Fixes FUNCTION_PROTOTYPE_DESCRIPTOR_LIES,
   * DEFINING_READ_ONLY_PROTO_FAILS_SILENTLY and
   * DEFINE_PROPERTY_CONFUSES_FUNC_PROTO.
   */
  function repair_DEFINE_PROPERTY() {
    function repairedDefineProperty(base, name, desc) {
      if (name === 'prototype' &&
          typeof base === 'function' &&
          'value' in desc) {
        try {
          base.prototype = desc.value;
        } catch (err) {
          logger.warn('prototype fixup failed', err);
          throw err;
        }
      } else if (name === '__proto__' && !isExtensible(base)) {
        throw TypeError('Cannot redefine __proto__ on a non-extensible object');
      }
      return unsafeDefProp(base, name, desc);
    }
    Object.defineProperty(Object, 'defineProperty', {
      value: repairedDefineProperty
    });
  }

  function repair_REGEXP_CANT_BE_NEUTERED() {
    var UnsafeRegExp = RegExp;
    var FakeRegExp = function RegExpWrapper(pattern, flags) {
      switch (arguments.length) {
        case 0: {
          return UnsafeRegExp();
        }
        case 1: {
          return UnsafeRegExp(pattern);
        }
        default: {
          return UnsafeRegExp(pattern, flags);
        }
      }
    };
    Object.defineProperty(FakeRegExp, 'prototype', {
      value: UnsafeRegExp.prototype
    });
    Object.defineProperty(FakeRegExp.prototype, 'constructor', {
      value: FakeRegExp
    });
    RegExp = FakeRegExp;
  }

  /**
   * Return a function suitable for using as a forEach argument on a
   * list of method names, where that function will monkey patch each
   * of these names methods on {@code ctor.prototype} so that they
   * can't be called on a {@code ctor.prototype} itself even across
   * frames.
   *
   * <p>This only works when {@code ctor} is the constructor of
   * objects that are supposed to pass hasBrand, and
   * ctor.prototype inappropriately also passes the hasBrand. To
   * test for {@code ctor.prototype} cross-frame, we observe that
   * for all objects that do pass the hasBrand, only the
   * ctor.prototype objects directly inherit from an object that
   * does not pass this hasBrand.
   */
  function makeMutableProtoPatcher(ctor, hasBrand) {
    var proto = ctor.prototype;
    if (!hasBrand(proto)) {
      throw new TypeError('unexpected: ' + proto);
    }
    var grandProto = getPrototypeOf(proto);
    if (hasBrand(grandProto)) {
      throw new TypeError('malformed inheritance: ' + ctor);
    }
    if (grandProto !== Object.prototype) {
      logger.log('unexpected inheritance: ' + ctor);
    }
    function mutableProtoPatcher(name) {
      if (!hop.call(proto, name)) { return; }
      var originalMethod = proto[name];
      function replacement(var_args) {
        var parent = getPrototypeOf(this);
        if (parent !== proto) {
          // In the typical case, parent === proto, so the above test
          // lets the typical case succeed quickly.
          // Note that, even if parent === proto, that does not
          // necessarily mean that the method application will
          // succeed, since, for example, a non-Date can still inherit
          // from Date.prototype. However, in such cases, the built-in
          // method application will fail on its own without our help.
          if (!hasBrand(parent)) {
            // As above, hasBrand(parent) being true does not
            // necessarily mean success, but the built-in failure
            // again would not need our help.
            if (hasBrand(this)) {
              throw new TypeError('May not mutate internal state of a ' +
                                  ctor + '.prototype');
            } else {
              throw new TypeError('Unexpected: ' + this);
            }
          }
        }
        return originalMethod.apply(this, arguments);
      }
      replacement.prototype = null;
      var w = funcLike(replacement, originalMethod);
      Object.defineProperty(proto, name, { value: w });
    }
    return mutableProtoPatcher;
  }


  function repair_MUTABLE_DATE_PROTO() {
    // Note: coordinate this list with maintenance of whitelist.js
    ['setYear',
     'setTime',
     'setFullYear',
     'setUTCFullYear',
     'setMonth',
     'setUTCMonth',
     'setDate',
     'setUTCDate',
     'setHours',
     'setUTCHours',
     'setMinutes',
     'setUTCMinutes',
     'setSeconds',
     'setUTCSeconds',
     'setMilliseconds',
     'setUTCMilliseconds'].forEach(
         makeMutableProtoPatcher(Date, isBuiltinDate));
  }

  function repair_MUTABLE_WEAKMAP_PROTO() {
    // Note: coordinate this list with maintanence of whitelist.js
    ['set',
     'delete'].forEach(makeMutableProtoPatcher(WeakMap, isBuiltinWeakMap));
  }

  function repair_NEED_TO_WRAP_FOREACH() {
    Object.defineProperty(Array.prototype, 'forEach', {
      // Taken from https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/Array/forEach
      value: function(callback, thisArg) {
        var T, k;
        if (this === null || this === undefined) {
          throw new TypeError('this is null or not defined');
        }
        var O = Object(this);
        var len = O.length >>> 0;
        if (typeof callback !== 'function') {
          throw new TypeError(callback + ' is not a function');
        }
        T = thisArg;
        k = 0;
        while(k < len) {
          var kValue;
          if (k in O) {
            kValue = O[k];
            callback.call(T, kValue, k, O);
          }
          k++;
        }
      }
    });
  }

  function repair_JSON_PARSE_PROTO_CONFUSION() {
    var unsafeParse = JSON.parse;
    function validate(plainJSON) {
      if (plainJSON !== Object(plainJSON)) {
        // If we were trying to do a full validation, we would
        // validate that it is not NaN, Infinity, -Infinity, or
        // (if nested) undefined. However, we are currently only
        // trying to repair
        // https://code.google.com/p/v8/issues/detail?id=621
        // That's why this special case validate function is private
        // to this repair.
        return;
      }
      var proto = getPrototypeOf(plainJSON);
      if (proto !== Object.prototype && proto !== Array.prototype) {
        throw new TypeError(
          'Parse resulted in invalid JSON. ' +
            'See https://code.google.com/p/v8/issues/detail?id=621');
      }
      Object.keys(plainJSON).forEach(function(key) {
        validate(plainJSON[key]);
      });
    }
    Object.defineProperty(JSON, 'parse', {
      value: function parseWrapper(text, opt_reviver) {
        var result = unsafeParse(text);
        validate(result);
        if (opt_reviver) {
          return unsafeParse(text, opt_reviver);
        } else {
          return result;
        }
      },
      writable: true,
      enumerable: false,
      configurable: true
    });
  }

  function repair_PARSEINT_STILL_PARSING_OCTAL() {
    var badParseInt = parseInt;
    function goodParseInt(n, radix) {
      n = '' + n;
      // This turns an undefined radix into a NaN but is ok since NaN
      // is treated as undefined by badParseInt
      radix = +radix;
      var isHexOrOctal = /^\s*[+-]?\s*0(x?)/.exec(n);
      var isOct = isHexOrOctal ? isHexOrOctal[1] !== 'x' : false;

      if (isOct && (radix !== radix || 0 === radix)) {
        return badParseInt(n, 10);
      }
      return badParseInt(n, radix);
    }
    parseInt = goodParseInt;
  }

  function repair_ASSIGN_CAN_OVERRIDE_FROZEN() {
    simpleTamperProofOk = true;
  }

  function repair_CANT_REDEFINE_NAN_TO_ITSELF() {
    var defProp = Object.defineProperty;
    // 'value' handled separately
    var attrs = ['writable', 'get', 'set', 'enumerable', 'configurable'];

    defProp(Object, 'defineProperty', {
      value: function(base, name, desc) {
        try {
          return defProp(base, name, desc);
        } catch (err) {
          var oldDesc = Object.getOwnPropertyDescriptor(base, name);
          for (var i = 0, len = attrs.length; i < len; i++) {
            var attr = attrs[i];
            if (attr in desc && desc[attr] !== oldDesc[attr]) { throw err; }
          }
          if (!('value' in desc) || is(desc.value, oldDesc.value)) {
            return base;
          }
          throw err;
        }
      }
    });
  }

  function repair_FREEZE_IS_FRAME_DEPENDENT() {
    // Every operation which sets an object's [[Extensible]] to false.
    fix('preventExtensions');
    fix('freeze');
    fix('seal');

    function fix(prop) {
      var base = Object[prop];
      Object.defineProperty(Object, prop, {
        configurable: true,  // attributes per ES5.1 section 15
        writable: true,
        value: function frameCheckWrapper(obj) {
          var parent = obj;
          while (Object.getPrototypeOf(parent) !== null) {
            parent = Object.getPrototypeOf(parent);
          }
          if (parent === obj || parent === Object.prototype) {
            // Unsoundly assuming this object is from this frame; we're trying
            // to catch mistakes here, not to do a 100% repair.
            return base(obj);
          } else {
            throw new Error(
                'Cannot reliably ' + prop + ' object from other frame.');
          }
        }
      });
    }
  }

  function repair_UNSHIFT_IGNORES_READONLY() {
    var baseSplice = Array.prototype.splice;
    var baseConcat = Array.prototype.concat;
    Object.defineProperty(Array.prototype, 'unshift', {
      value: function(var_args) {
        var len = +this.length;
        var items = slice.call(arguments, 0);
        baseSplice.apply(this, baseConcat.call([0, 0], items));
        return len + items.length;
      },
      configurable: true,
      writable: true
    });
  }

  function repair_SHIFT_IGNORES_READONLY() {
    var baseSplice = Array.prototype.splice;
    Object.defineProperty(Array.prototype, 'shift', {
      value: function() {
        if (+this.length >= 1) {
          var result = this[0];
          baseSplice.call(this, 0, 1);
          return result;
        }
        return void 0;
      },
      configurable: true,
      writable: true
    });
  }

  function repair_POP_IGNORES_FROZEN() {
    var pop = Array.prototype.pop;
    var frozen = Object.isFrozen;
    Object.defineProperty(Array.prototype, 'pop', {
      value: function () {
        if (frozen(this)) {
          throw new TypeError('Cannot pop a frozen object.');
        }
        return pop.call(this);
      },
      configurable : true,
      writable: true
    });
  }

  function repair_SORT_IGNORES_FROZEN() {
    var sort = Array.prototype.sort;
    var frozen = Object.isFrozen;
    Object.defineProperty(Array.prototype, 'sort', {
      value: function (compareFn) {
        if (frozen(this)) {
          throw new TypeError('Cannot sort a frozen object.');
        }
        if (arguments.length === 0) {
          return sort.call(this);
        } else {
          return sort.call(this, compareFn);
        }
      },
      configurable: true,
      writable: true
    });
  }

  function repair_PUSH_IGNORES_SEALED() {
    var push = Array.prototype.push;
    var sealed = Object.isSealed;
    Object.defineProperty(Array.prototype, 'push', {
      value: function(compareFn) {
        if (sealed(this)) {
          throw new TypeError('Cannot push onto a sealed object.');
        }
        return push.apply(this, arguments);
      },
      configurable: true,
      writable: true
    });
  }

  function repair_ARRAY_LENGTH_MUTABLE() {
    var freeze = Object.freeze;
    var seal = Object.seal;
    var preventExtensions = Object.preventExtensions;
    var isArray = Array.isArray;
    ['freeze', 'seal', 'preventExtensions'].forEach(function(prop) {
      var desc = Object.getOwnPropertyDescriptor(Object, prop);
      var existingMethod = desc.value;
      desc.value = function protectLengthWrapper(O) {
        if (isArray(O)) {
          var lengthDesc = Object.getOwnPropertyDescriptor(O, 'length');
          // This is the key repair: making length specifically non-writable
          // forces the slow path for array-modifying operations where an
          // ordinary freeze doesn't. Note that this is technically incorrect
          // for seal and preventExtensions, but modifying the length of such
          // an array makes little sense anyway.
          if (typeof lengthDesc.writable === 'boolean') {
            lengthDesc.writable = false;
            Object.defineProperty(O, 'length', lengthDesc);
          }
        }
        existingMethod(O);
        return O;
      };
      Object.defineProperty(Object, prop, desc);
    });
  }

  // error message is matched elsewhere (for tighter bounds on catch)
  var NO_CREATE_NULL =
      'Repaired Object.create can not support Object.create(null)';
  // optional argument is used for the test-of-repair
  function repair_FREEZING_BREAKS_PROTOTYPES(opt_Object) {
    var baseObject = opt_Object || Object;
    var baseDefProp = baseObject.defineProperties;

    // Object.create fails to override [[Prototype]]; reimplement it.
    baseObject.defineProperty(baseObject, 'create', {
      configurable: true,  // attributes per ES5.1 section 15
      writable: true,
      value: function repairedObjectCreate(O, Properties) {
        if (O === null) {
          // Not ES5 conformant, but hopefully adequate for Caja as ES5/3 also
          // does not support Object.create(null).
          throw new TypeError(NO_CREATE_NULL);
        }
        // "1. If Type(O) is not Object or Null throw a TypeError exception."
        if (O !== Object(O)) {
          throw new TypeError('Object.create: prototype must be an object');
        }
        // "2. Let obj be the result of creating a new object as if by the
        // expression new Object() where Object is the standard built-in
        // constructor with that name"
        // "3. Set the [[Prototype]] internal property of obj to O."
        // Cannot redefine [[Prototype]], so we use the .prototype trick instead
        function temporaryConstructor() {}
        temporaryConstructor.prototype = O;
        var obj = new temporaryConstructor();
        // "4. If the argument Properties is present and not undefined, add own
        // properties to obj as if by calling the standard built-in function
        // Object.defineProperties with arguments obj and Properties."
        if (Properties !== void 0) {
          baseDefProp(obj, Properties);
        }
        // "5. Return obj."
        return obj;
      }
    });

    var baseErrorToString = Error.prototype.toString;

    // Error.prototype.toString fails to use the .name and .message.
    // This is being repaired not because it is a critical issue but because
    // it is more direct than disabling the tests of error taming which fail.
    baseObject.defineProperty(Error.prototype, 'toString', {
      configurable: true,  // attributes per ES5.1 section 15
      writable: true,
      value: function repairedErrorToString() {
        // "1. Let O be the this value."
        var O = this;
        // "2. If Type(O) is not Object, throw a TypeError exception."
        if (O !== baseObject(O)) {
          throw new TypeError('Error.prototype.toString: this not an object');
        }
        // "3. Let name be the result of calling the [[Get]] internal method of
        // O with argument "name"."
        var name = O.name;
        // "4. If name is undefined, then let name be "Error"; else let name be
        // ToString(name)."
        name = name === void 0 ? 'Error' : '' + name;
        // "5. Let msg be the result of calling the [[Get]] internal method of O
        // with argument "message"."
        var msg = O.message;
        // "6. If msg is undefined, then let msg be the empty String; else let
        // msg be ToString(msg)."
        msg = msg === void 0 ? '' : '' + msg;
        // "7. If msg is undefined, then let msg be the empty String; else let
        // msg be ToString(msg)."
        msg = msg === void 0 ? '' : '' + msg;
        // "8. If name is the empty String, return msg."
        if (name === '') { return msg; }
        // "9. If msg is the empty String, return name."
        if (msg === '') { return name; }
        // "10. Return the result of concatenating name, ":", a single space
        // character, and msg."
        return name + ': ' + msg;
      }
    });

    if (baseObject === Object) {
      repair_FREEZING_BREAKS_PROTOTYPES_wasApplied = true;
    }
  }

  function repair_FREEZING_BREAKS_WEAKMAP() {
    global.WeakMap = undefined;
  }

  /**
   * Note that this repair does not repair the Function constructor
   * itself at this stage. Rather, it repairs ses.verifyStrictFunctionBody,
   * which startSES uses to build a safe Function constructor from the
   * unsafe one.
   *
   * <p>The repair strategy depends on what other bugs this platform
   * suffers from. In the absence of SYNTAX_ERRORS_ARENT_ALWAYS_EARLY,
   * STRICT_EVAL_LEAKS_GLOBAL_VARS, and
   * STRICT_EVAL_LEAKS_GLOBAL_FUNCS, then we can use the cheaper
   * verifyStrictFunctionBodyByEvalThrowing. Otherwise, if a parser is
   * available, we use verifyStrictFunctionBodyByParsing. Otherwise we
   * fail to repair.
   */
  function repair_CANT_SAFELY_VERIFY_SYNTAX() {
    if (!test_SYNTAX_ERRORS_ARENT_ALWAYS_EARLY() &&
        !test_STRICT_EVAL_LEAKS_GLOBAL_VARS() &&
        !test_STRICT_EVAL_LEAKS_GLOBAL_FUNCS()) {
      ses.verifyStrictFunctionBody = verifyStrictFunctionBodyByEvalThrowing;
    } else if (canMitigateSrcGotchas) {
      ses.verifyStrictFunctionBody = verifyStrictFunctionBodyByParsing;
    } else {
      // No known repairs under these conditions
    }
  }

  function repair_TYPED_ARRAYS_THROW_DOMEXCEPTION() {
    var protos = typedArrayNames.map(
        function(ctorName) { return global[ctorName].prototype; });
    protos.push(global.DataView.prototype);
    protos.forEach(function(proto) {
      Object.getOwnPropertyNames(proto).forEach(function(prop) {
        function exceptionAdapterWrapper(var_args) {
          try {
            origMethod.apply(this, arguments);
          } catch (e) {
            if (e instanceof DOMException) {
              throw new RangeError(e.message);
            }
          }
        }
        if (/^[gs]et/.test(prop)) {
          var origMethod = proto[prop];
          proto[prop] = funcLike(exceptionAdapterWrapper, origMethod);
        }
      });
    });
  }

  function repair_TYPED_ARRAY_PROTOS_LOOK_UNFROZEN(opt_global) {
    var targetGlobal = opt_global || global;
    var typedArrayProtos = targetGlobal.Object.freeze(typedArrayNames.map(
        function(ctorName) { return targetGlobal[ctorName].prototype; }));

    var isFrozen = targetGlobal.Object.isFrozen;
    var getOwnPropertyDescriptor = targetGlobal.Object.getOwnPropertyDescriptor;

    Object.defineProperty(targetGlobal.Object, 'getOwnPropertyDescriptor', {
      configurable: true,
      writable: true,  // allow other repairs to stack on
      value: function getOwnPropertyDescriptor_typedArrayPatch(object, prop) {
        var desc = getOwnPropertyDescriptor(object, prop);
        if (desc && typedArrayProtos.indexOf(object) !== -1 &&
            'value' in desc && ses._primordialsHaveBeenFrozen) {
          // If it is one of the typed array prototypes then it will have been
          // frozen by startSES.
          desc.writable = false;
        }
        return desc;
      }
    });

    Object.defineProperty(targetGlobal.Object, 'isFrozen', {
      configurable: true,
      writable: true,  // allow other repairs to stack on
      value: function isFrozen_typedArrayPatch(object) {
        // If it is one of the typed array prototypes then it will have been
        // frozen by startSES.
        var v = typedArrayProtos.indexOf(object) !== -1;
        return isFrozen(object) || (v && ses._primordialsHaveBeenFrozen);
      }
    });

    // isSealed does not need repair as it already gives the correct answer.

    if (targetGlobal === global) {
      repair_TYPED_ARRAY_PROTOS_LOOK_UNFROZEN_wasApplied = true;
    }
  }

  function repair_GLOBAL_LEAKS_FROM_ARRAY_METHODS() {
    var object = Array.prototype;
    [
      'concat', 'pop', 'push', 'shift', 'slice', 'splice', 'unshift'
    ].forEach(function(name) {
      // reuse desc to avoid reiterating prop attributes
      var desc = Object.getOwnPropertyDescriptor(object, name);
      var existingMethod = desc.value;

      if (Function.prototype.toString.call(existingMethod)
          .indexOf('[native code]') === -1) {
        // If the function has already been wrapped by one of our other repairs,
        // then we don't need to introduce this additional wrapper.
        return;
      }

      function globalLeakDefenseWrapper() {
        // To repair this bug it is sufficient to force the method to be called
        // using .apply(), as it only occurs if it is called as a literal
        // function, e.g. var concat = Array.prototype.concat; concat().
        return existingMethod.apply(this, arguments);
      }
      desc.value = funcLike(globalLeakDefenseWrapper, existingMethod);
      Object.defineProperty(object, name, desc);
    });
  }

  function repair_NUMERIC_PROPERTIES_INVISIBLE() {
    var create = Object.create;

    var tempPropName = '0';
    var tempPropDesc = {configurable: true};

    Object.defineProperty(Object, 'create', {
      configurable: true,
      writable: true,  // allow other repairs to stack on
      value: function repairedCreate(prototype, props) {
        var o = create(prototype);
        // Any property defined using a descriptor is sufficient to suppress
        // the misbehavior.
        Object.defineProperty(o, tempPropName, tempPropDesc);
        delete o[tempPropName];
        // By deferring the defineProperties operation, we avoid possibly
        // conflicting with the caller-specified property names, without
        // needing to examine props twice.
        if (props !== undefined) {
          Object.defineProperties(o, props);
        }
        return o;
      }
    });
  }

  /**
   * Repairs both getter and setter. If either are vulnerable, I don't
   * care if the other seemed to pass the test. Better to make them
   * both safe.
   */
  function repair_UNDERBAR_PROTO_accessors_USE_GLOBAL() {
    var gopd = Object.getOwnPropertyDescriptor;

    var oldDesc = gopd(Object.prototype, '__proto__');
    var oldGetter = oldDesc.get;
    var oldSetter = oldDesc.set;
    function newGetter() {
      if (this === null || this === void 0) {
        throw new TypeError('Cannot convert null or undefined to object');
      } else {
        return oldGetter.call(this);
      }
    }
    function newSetter(newProto) {
      if (this === null || this === void 0) {
        throw new TypeError('Cannot convert null or undefined to object');
      } else {
        oldSetter.call(this, newProto);
      }
    }
    Object.defineProperty(Object.prototype, '__proto__', {
      get: oldGetter ? newGetter : void 0,
      set: oldSetter ? newSetter : void 0
    });
  }

  /**
   * According to
   * https://bugzilla.mozilla.org/show_bug.cgi?id=1125389#c28 comment 28
   * <blockquote>
   *   <blockquote>
   *      [...] is there anything that content script could do to prevent
   *      this bug from occurring?
   *   </blockquote>
   *     [...] If the object which preventExtensions is called on has
   *     any properties which are non-configurable or non-writable
   *     then the bug won't impact anything (so calling seal() or
   *     freeze() on an object with at least one property shouldn't be
   *     able to trigger this bug)
   * </blockquote>
   *
   * <p>WeakMap.js, if it needs to install a WeakMap emulation, does
   * so by adding a hidden own property to objects at the time they
   * would be made non-extensible, by monkey patching those functions
   * that would make them non-extensible. It also monkey patches those
   * functions that would reveal non-enumerable own properties, so
   * that they don't reveal this hidden property.
   *
   * <p>Were both this repair and the WeakMap emulation of more long
   * term interest, we should find a way to reuse this monkey patching
   * logic, so the same monkey patching could serve both purposes. As
   * it is, this repair becomes unneeded as of FF36, as the underlying
   * problem is fixed there, so we expediently that part of
   * WeakMap.js's logic without worrying about reusable
   * abstractions. Unlike the WeakMap fix, here, the hidden property
   * need not be unguessage, but only resistent to accidental
   * collision. If the WeakMap installation repair happens on top of
   * this one, they should compose fine.
   */
  function repair_NON_EXTENSIBLES_EXTENSIBLE() {
    var gopn = Object.getOwnPropertyNames;
    var defProp = Object.defineProperty;
    var isExtensible = Object.isExtensible;

    var DUMMY_NAME = '___j9d04gcuzydmfgvi___';

    function isNotDummyName(name) { return name !== DUMMY_NAME; }

    // For all calls to Object.defineProperty (defProp) to redefine an
    // existing property, keep in mind that omitting some attributes,
    // like writable:, enumerable:, or configurable:, means that the
    // current setting of these attributes should be preseved, rather
    // than defaulting to false.

    // Note that the use of .filter as an array instance method below
    // only works in SES under the immutable primordials
    // assumption. For example, it would not work in CES (Confined
    // EcmaScript).

    defProp(Object, 'getOwnPropertyNames', {
      value: function nonDummyGetOwnPropertyNames(obj) {
        return gopn(obj).filter(isNotDummyName);
      }
    });
    if ('getPropertyNames' in Object) {
      var originalGetPropertyNames = Object.getPropertyNames;
      defProp(Object, 'getPropertyNames', {
        value: function nonDummyGetPropertyNames(obj) {
          return originalGetPropertyNames(obj).filter(isNotDummyName);
        }
      });
    }

    function addDummyProperty(obj) {
      if (obj !== Object(obj)) { return; }
      if (!Object.isExtensible(obj)) { return; }
      defProp(obj, DUMMY_NAME, {
        value: 'DUMMY',
        writable: false,
        enumerable: false,
        configurable: false
      });
    }

    var oldFreeze = Object.freeze;
    defProp(Object, 'freeze', {
      value: function bogosifyingFreeze(obj) {
        addDummyProperty(obj);
        return oldFreeze(obj);
      }
    });

    var oldSeal = Object.seal;
    defProp(Object, 'seal', {
      value: function bogosifyingSeal(obj) {
        addDummyProperty(obj);
        return oldSeal(obj);
      }
    });

    var oldPreventExtensions = Object.preventExtensions;
    defProp(Object, 'preventExtensions', {
      value: function bogosifyingPreventExtensions(obj) {
        addDummyProperty(obj);
        return oldPreventExtensions(obj);
      }
    });
  }

  // See https://github.com/ljharb/Object.getOwnPropertyDescriptors
  function repair_MISSING_GET_OWN_PROPERTY_DESCRIPTORS() {
    function getOwnPropertyDescriptorsShim(obj) {
      const result = {};
      for (const key of Reflect.ownKeys(obj)) {
        const desc = Object.getOwnPropertyDescriptor(obj, key);
        Object.defineProperty(result, key, {
          value: desc,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
      return result;
    }
    Object.defineProperty(Object, 'getOwnPropertyDescriptors', {
      value: getOwnPropertyDescriptorsShim,
      writable: true,
      enumerable: false,
      configurable: true
    });
  }

  ////////////////////// Generic tests/repairs /////////////////////
  //
  // These are tests and repairs which follow a pattern, such that it is
  // more practical to define them programmatically.

  function arrayPutProblem(destination,
                           prop, testArgs, i, expected, kind, opt_repair) {
    var pos = ['first', 'last'][i];
    var descs = {
      readonly: {writable: false, configurable: false},
      non_writable: {writable: false}
    };
    var badness = {
      readonly: severities.UNSAFE_SPEC_VIOLATION,
      non_writable: severities.SAFE_SPEC_VIOLATION
    };

    /**
     * Tests for an array method modifying the value of a non-writable
     * indexed data property of an array.
     */
    function test_method_IGNORES_kind() {
      var x = ['c', 'b'];
      var val = x[i];
      Object.defineProperty(x, i, descs[kind]);
      try {
        x[prop].apply(x, testArgs);
      } catch (_) {
        if (x[i] === val) { return false; }
        return 'Unexpected error on ' + prop +
          ' of a ' + kind + ' property: ' + x;
      }
      if (x[i] === val) {
        // The problem is not that the PUT was ignored, but that
        // it didn't throw, which is detected by
        // test_method_DOESNT_THROW_kind() below.
        return false;
      }
      if (x[i] === expected) { return true; }
      return 'Unexpected behavior on ' + prop +
        ' of a ' + kind + ' property: ' + x;
    }

    /**
     * Tests for an array method not throwing when it tries to modify
     * the value of a non-writable indexed data property of an array.
     */
    function test_method_DOESNT_THROW_kind() {
      var x = ['c', 'b'];
      var val = x[i];
      Object.defineProperty(x, i, descs[kind]);
      try {
        x[prop].apply(x, testArgs);
      } catch (_) {
        return false;
      }
      return true;
    }

    destination.push({
      id: (prop + '_PUT_IGNORES_' + pos + '_' + kind).toUpperCase(),
      description: 'Array.prototype.' + prop + ' ignores ' +
        kind + ' on ' + pos + ' property',
      test: test_method_IGNORES_kind,
      repair: opt_repair,
      preSeverity: badness[kind],
      canRepair: opt_repair !== void 0,
      urls: ['https://code.google.com/p/v8/issues/detail?id=3356',
             'https://code.google.com/p/google-caja/issues/detail?id=1931',
             'https://code.google.com/p/v8/issues/detail?id=2615'],
      sections: [],
      tests: [] // TODO(jasvir): Add to test262
    });
    destination.push({
      id: (prop + '_PUT_DOESNT_THROW_' + pos + '_' + kind).toUpperCase(),
      description: 'Array.prototype.' + prop + ' doesn\'t throw on ' +
        kind + ' ' + pos + ' property',
      test: test_method_DOESNT_THROW_kind,
      repair: opt_repair,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: opt_repair !== void 0,
      urls: ['https://code.google.com/p/v8/issues/detail?id=3356',
             'https://code.google.com/p/google-caja/issues/detail?id=1931',
             'https://code.google.com/p/v8/issues/detail?id=2615'],
      sections: [],
      tests: [] // TODO(jasvir): Add to test262
    });
  }

  function arraySealProblem(destination, prop, testArgs) {
    /**
     * Tests only for likely symptoms of a seal violation or a
     * malformed array.
     *
     * <p>A sealed object can neither acquire new own properties
     * (because it is non-extensible) nor lose existing own properties
     * (because all its existing own properties are non-configurable),
     * so we check that the own properties that these methods would
     * normally manipulate remain in their original state. Changing
     * the "length" property of the array would not itself be a seal
     * violation, but if there is no other seal violation, such a
     * length change would result in a malformed array. (If needed,
     * the extensibility, non-deletability, and length change tests
     * could be separated into distinct tests.)
     */
    function test_method_IGNORES_SEALED() {
      var x = [2, 1];  // disordered to detect sort()
      Object.seal(x);
      try {
        x[prop].apply(x, testArgs);
      } catch (e) {
        // It is actually still a non-conformance if the array was not
        // badly mutated but the method did not throw, but not an
        // UNSAFE_SPEC_VIOLATION.
      }
      return !(x.length === 2 && ('0' in x) && ('1' in x) && !('2' in x));
    }

    /**
     * Tests for likely symptoms of a freeze violation.
     *
     * <p>A frozen object can neither acquire new own properties
     * (because it is non-extensible) nor can any of its existing own
     * data properties be mutated (since they are non-configurable,
     * non-writable). So we check for any of the mutations that these
     * methods would normally cause.
     */
    function test_method_IGNORES_FROZEN() {
      var x = [2, 1];  // disordered to detect sort()
      Object.freeze(x);
      try {
        x[prop].apply(x, testArgs);
      } catch (e) {
        // It is actually still a non-conformance if the array was not
        // mutated but the method did not throw, but not an
        // UNSAFE_SPEC_VIOLATION.
      }
      return !(x.length === 2 && x[0] === 2 && x[1] === 1 && !('2' in x));
    }

    function repair_method_IGNORES_SEALED() {
      var originalMethod = Array.prototype[prop];
      var isSealed = Object.isSealed;
      function repairedArrayMutator(var_args) {
        if (isSealed(this)) {
          throw new TypeError('Cannot mutate a sealed array.');
        }
        return originalMethod.apply(this, arguments);
      }
      Object.defineProperty(Array.prototype, prop, {
        value: funcLike(repairedArrayMutator, originalMethod),
        configurable: true,
        writable: true
      });
    }

    destination.push({
      id: (prop + '_IGNORES_SEALED').toUpperCase(),
      description: 'Array.prototype.' + prop + ' ignores sealing',
      test: test_method_IGNORES_SEALED,
      repair: repair_method_IGNORES_SEALED,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // does not protect individual properties, only
          // fully sealed objects
      urls: [
          'https://code.google.com/p/v8/issues/detail?id=2615',
          'https://code.google.com/p/v8/issues/detail?id=2711'],
      sections: ['15.2.3.8'],
      tests: [] // TODO(jasvir): Add to test262
    });
    destination.push({
      id: (prop + '_IGNORES_FROZEN').toUpperCase(),
      description: 'Array.prototype.' + prop + ' ignores freezing',
      test: test_method_IGNORES_FROZEN,
      repair: repair_method_IGNORES_SEALED,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: [
          'https://code.google.com/p/v8/issues/detail?id=2615',
          'https://code.google.com/p/v8/issues/detail?id=2711'],
      sections: ['15.2.3.9'],
      tests: [] // TODO(jasvir): Add to test262
    });
  }

  ////////////////////// Problem Records /////////////////////

  /**
   * First test whether the platform can even support our repair
   * attempts.
   */
  var baseProblems = [
    {
      id: 'MISSING_GETOWNPROPNAMES',
      description: 'Missing getOwnPropertyNames',
      test: test_MISSING_GETOWNPROPNAMES,
      repair: void 0,
      preSeverity: severities.NOT_SUPPORTED,
      canRepair: false,
      urls: [],
      sections: ['15.2.3.4'],
      tests: ['test/built-ins/Object/getOwnPropertyNames/15.2.3.4-0-1.js']
    },
    {
      id: 'PROTO_SETTER_UNGETTABLE',
      description: "Can't get Object.prototype.__proto__'s setter",
      test: test_PROTO_SETTER_UNGETTABLE,
      repair: void 0,
      preSeverity: severities.NOT_SUPPORTED,
      canRepair: false,
      urls: ['mailto:DSK-383293@bugs.opera.com'],
      sections: [],
      tests: []
    }
  ];

  /**
   * Run these only if baseProblems report success.
   */
  var supportedProblems = [
    {
      id: 'GLOBAL_LEAKS_FROM_GLOBAL_FUNCTION_CALLS',
      description: 'Global object leaks from global function calls',
      test: test_GLOBAL_LEAKS_FROM_GLOBAL_FUNCTION_CALLS,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,  // Not repairable without rewriting
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=64250'],
      sections: ['10.2.1.2', '10.2.1.2.6'],
      tests: ['test/language/function-code/10.4.3-1-8gs.js']
    },
    {
      id: 'GLOBAL_LEAKS_FROM_ANON_FUNCTION_CALLS',
      description: 'Global object leaks from anonymous function calls',
      test: test_GLOBAL_LEAKS_FROM_ANON_FUNCTION_CALLS,
      repair: void 0,  // Not repairable without rewriting
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,
      urls: [],
      sections: ['10.4.3'],
      tests: ['test/language/function-code/S10.4.3_A1.js']
    },
    {
      id: 'GLOBAL_LEAKS_FROM_STRICT_THIS',
      description: 'Global leaks through strict this',
      test: test_GLOBAL_LEAKS_FROM_STRICT_THIS,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,  // Not repairable without rewriting
      urls: [],
      sections: ['10.4.3'],
      tests: ['test/language/function-code/10.4.3-1-8gs.js',
              'test/language/function-code/10.4.3-1-8-s.js']
    },
    {
      id: 'GLOBAL_LEAKS_FROM_BUILTINS',
      description: 'Global object leaks from built-in methods',
      test: test_GLOBAL_LEAKS_FROM_BUILTINS,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,  // No platform with this bug is fully repairable,
          // so it's not worth creating a repair for this bug.
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=51097',
             'https://bugs.webkit.org/show_bug.cgi?id=58338',
             'https://code.google.com/p/v8/issues/detail?id=1437',
             'https://connect.microsoft.com/IE/feedback/details/' +
               '685430/global-object-leaks-from-built-in-methods'],
      sections: ['15.2.4.4'],
      tests: ['test/built-ins/Object/prototype/valueOf/S15.2.4.4_A14.js']
    },
    {
      id: 'GLOBAL_LEAKS_FROM_GLOBALLY_CALLED_BUILTINS',
      description: 'Global object leaks from globally called built-in methods',
      test: test_GLOBAL_LEAKS_FROM_GLOBALLY_CALLED_BUILTINS,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,  // No platform with this bug is fully repairable,
          // so it's not worth creating a repair for this bug.
      urls: [],
      sections: ['10.2.1.2', '10.2.1.2.6', '15.2.4.4'],
      tests: ['test/built-ins/Object/prototype/valueOf/S15.2.4.4_A15.js']
    },
    {
      id: 'MISSING_FREEZE_ETC',
      description: 'Object.freeze is missing',
      test: test_MISSING_FREEZE_ETC,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=55736'],
      sections: ['15.2.3.9'],
      tests: ['test/built-ins/Object/freeze/15.2.3.9-0-1.js']
    },
    {
      id: 'FUNCTION_PROTOTYPE_DESCRIPTOR_LIES',
      description: 'A function.prototype\'s descriptor lies',
      test: test_FUNCTION_PROTOTYPE_DESCRIPTOR_LIES,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=1530',
             'https://code.google.com/p/v8/issues/detail?id=1570'],
      sections: ['15.2.3.3', '15.2.3.6', '15.3.5.2'],
      tests: ['test/built-ins/Function/prototype/S15.3.3.1_A4.js']
    },
    {
      id: 'MISSING_CALLEE_DESCRIPTOR',
      description: 'Phantom callee on strict functions',
      test: test_MISSING_CALLEE_DESCRIPTOR,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=55537'],
      sections: ['15.2.3.4'],
      tests: ['test/built-ins/Object/getOwnPropertyNames/S15.2.3.4_A1_T1.js']
    },
    {
      id: 'STRICT_DELETE_RETURNS_FALSE',
      description: 'Strict delete returned false rather than throwing',
      test: test_STRICT_DELETE_RETURNS_FALSE,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // Not repairable without rewriting
      urls: ['https://connect.microsoft.com/IE/feedback/details/' +
               '685432/strict-delete-sometimes-returns-false-' +
               'rather-than-throwing'],
      sections: ['11.4.1'],
      tests: ['test/language/expressions/delete/S11.4.1_A5.js']
    },
    {
      id: 'REGEXP_CANT_BE_NEUTERED',
      description: 'Non-deletable RegExp statics are a' +
        ' global communication channel',
      test: test_REGEXP_CANT_BE_NEUTERED,
      repair: repair_REGEXP_CANT_BE_NEUTERED,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: true,
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=591846',
             'http://wiki.ecmascript.org/doku.php?id=' +
               'conventions:make_non-standard_properties_configurable',
             'https://connect.microsoft.com/IE/feedback/details/' +
               '685439/non-deletable-regexp-statics-are-a-global-' +
               'communication-channel'],
      sections: ['11.4.1'],
      tests: ['test/language/expressions/delete/S11.4.1_A5.js']
    },
    {
      id: 'REGEXP_TEST_EXEC_UNSAFE',
      description: 'RegExp.exec leaks match globally',
      test: test_REGEXP_TEST_EXEC_UNSAFE,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=1393',
             'https://code.google.com/p/chromium/issues/detail?id=75740',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=635017',
             'https://code.google.com/p/google-caja/issues/detail?id=528'],
      sections: ['15.10.6.2'],
      tests: ['test/built-ins/RegExp/prototype/exec/S15.10.6.2_A12.js']
    },
    {
      id: 'MISSING_BIND',
      description: 'Function.prototype.bind is missing',
      test: test_MISSING_BIND,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=26382',
             'https://bugs.webkit.org/show_bug.cgi?id=42371'],
      sections: ['15.3.4.5'],
      tests: ['test/built-ins/Function/prototype/bind/S15.3.4.5_A3.js']
    },
    {
      id: 'BIND_CALLS_APPLY',
      description: 'Function.prototype.bind calls .apply rather than [[Call]]',
      test: test_BIND_CALLS_APPLY,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=892',
             'https://code.google.com/p/v8/issues/detail?id=828'],
      sections: ['15.3.4.5.1'],
      tests: ['test/built-ins/Function/prototype/bind/S15.3.4.5_A4.js']
    },
    {
      id: 'BIND_CANT_CURRY_NEW',
      description: 'Function.prototype.bind does not curry construction',
      test: test_BIND_CANT_CURRY_NEW,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // JS-based repair essentially impossible
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=26382#c29'],
      sections: ['15.3.4.5.2'],
      tests: ['test/built-ins/Function/prototype/bind/S15.3.4.5_A5.js']
    },
    {
      id: 'MUTABLE_DATE_PROTO',
      description: 'Date.prototype is a global communication channel',
      test: test_MUTABLE_DATE_PROTO,
      repair: repair_MUTABLE_DATE_PROTO,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: true,
      urls: ['https://code.google.com/p/google-caja/issues/detail?id=1362',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=797686',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=861219',
             'https://code.google.com/p/v8/issues/detail?id=3890',
             'https://bugs.webkit.org/show_bug.cgi?id=141610',
             'https://connect.microsoft.com/IE/feedbackdetail/view/1131123/for-many-x-x-prototype-is-an-x-when-it-must-be-a-plain-object'],
      sections: ['15.9.5'],
      tests: []
    },
    {
      id: 'MUTABLE_WEAKMAP_PROTO',
      description: 'WeakMap.prototype is a global communication channel',
      test: test_MUTABLE_WEAKMAP_PROTO,
      repair: repair_MUTABLE_WEAKMAP_PROTO,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: true,
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=656828',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=797686'],
      sections: [],
      tests: []
    },
    {
      id: 'DATE_PROTO_IS_DATE',
      description: 'Date.prototype should be a plain object',
      test: test_DATE_PROTO_IS_DATE,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=797686',
             'https://code.google.com/p/v8/issues/detail?id=3890',
             'https://bugs.webkit.org/show_bug.cgi?id=141610',
             'https://connect.microsoft.com/IE/feedbackdetail/view/1131123/for-many-x-x-prototype-is-an-x-when-it-must-be-a-plain-object'],
      sections: [],
      tests: []
    },
    {
      id: 'WEAKMAP_PROTO_IS_WEAKMAP',
      description: 'WeakMap.prototype should be a plain object',
      test: test_WEAKMAP_PROTO_IS_WEAKMAP,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=797686',
             'https://code.google.com/p/v8/issues/detail?id=3890',
             'https://bugs.webkit.org/show_bug.cgi?id=141610',
             'https://connect.microsoft.com/IE/feedbackdetail/view/1131123/for-many-x-x-prototype-is-an-x-when-it-must-be-a-plain-object'],
      sections: [],
      tests: []
    },
    {
      id: 'REGEXP_PROTO_IS_REGEXP',
      description: 'RegExp.prototype should be a plain object',
      test: test_REGEXP_PROTO_IS_REGEXP,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=797686',
             'https://code.google.com/p/v8/issues/detail?id=3890',
             'https://bugs.webkit.org/show_bug.cgi?id=141610',
             'https://connect.microsoft.com/IE/feedbackdetail/view/1131123/for-many-x-x-prototype-is-an-x-when-it-must-be-a-plain-object'],
      sections: [],
      tests: []
    },
    {
      id: 'NEED_TO_WRAP_FOREACH',
      description: 'Array forEach cannot be frozen while in progress',
      test: test_NEED_TO_WRAP_FOREACH,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=1447'],
      sections: ['15.4.4.18'],
      tests: ['test/built-ins/Array/prototype/forEach/S15.4.4.18_A1.js',
              'test/built-ins/Array/prototype/forEach/S15.4.4.18_A2.js']
    },
    {
      id: 'FOREACH_COERCES_THISOBJ',
      description: 'Array forEach converts primitive thisObj arg to object',
      test: test_FOREACH_COERCES_THISOBJ,
      repair: repair_NEED_TO_WRAP_FOREACH,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=2273',
             'https://developer.mozilla.org/en-US/docs/JavaScript/' +
               'Reference/Global_Objects/Array/forEach'],
      sections: ['15.4.4.18'],
      tests: []
    },
    {
      id: 'NEEDS_DUMMY_SETTER',
      description: 'Workaround undiagnosed need for dummy setter',
      test: test_NEEDS_DUMMY_SETTER,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/chromium/issues/detail?id=94666'],
      sections: [],
      tests: []
    },
    {
      id: 'FORM_GETTERS_DISAPPEAR',
      description: 'Getter on HTMLFormElement disappears',
      test: test_FORM_GETTERS_DISAPPEAR,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/chromium/issues/detail?id=94666',
             'https://code.google.com/p/v8/issues/detail?id=1651',
             'https://code.google.com/p/google-caja/issues/detail?id=1401'],
      sections: ['15.2.3.6'],
      tests: ['test/built-ins/Object/defineProperty/S15.2.3.6_A1.js']
    },
    {
      id: 'ACCESSORS_INHERIT_AS_OWN',
      description: 'Accessor properties inherit as own properties',
      test: test_ACCESSORS_INHERIT_AS_OWN,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=637994'],
      sections: ['8.6.1', '15.2.3.6'],
      tests: ['test/built-ins/Object/defineProperty/S15.2.3.6_A2.js']
    },
    {
      id: 'SORT_LEAKS_GLOBAL',
      description: 'Array sort leaks global',
      test: test_SORT_LEAKS_GLOBAL,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=1360'],
      sections: ['15.4.4.11'],
      tests: ['test/built-ins/Array/prototype/sort/S15.4.4.11_A8.js']
    },
    {
      id: 'REPLACE_LEAKS_GLOBAL',
      description: 'String replace leaks global',
      test: test_REPLACE_LEAKS_GLOBAL,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=1360',
             'https://connect.microsoft.com/IE/feedback/details/' +
               '685928/bad-this-binding-for-callback-in-string-' +
               'prototype-replace'],
      sections: ['15.5.4.11'],
      tests: ['test/built-ins/String/prototype/replace/S15.5.4.11_A12.js']
    },
    {
      id: 'CANT_GOPD_CALLER',
      description: 'getOwnPropertyDescriptor on strict "caller" fails',
      test: test_CANT_GOPD_CALLER,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://connect.microsoft.com/IE/feedback/details/' +
               '685436/getownpropertydescriptor-on-strict-caller-throws'],
      sections: ['15.2.3.3', '13.2', '13.2.3'],
      tests: ['test/language/statements/function/S13.2_A6_T1.js']
    },
    {
      id: 'CANT_HASOWNPROPERTY_CALLER',
      description: 'strict_function.hasOwnProperty("caller") fails',
      test: test_CANT_HASOWNPROPERTY_CALLER,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=63398#c3'],
      sections: ['15.2.4.5', '13.2', '13.2.3'],
      tests: ['test/language/statements/function/S13.2_A7_T1.js']
    },
    {
      id: 'CANT_IN_CALLER',
      description: 'Cannot "in" caller on strict function',
      test: test_CANT_IN_CALLER,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=63398'],
      sections: ['11.8.7', '13.2', '13.2.3'],
      tests: ['test/language/statements/function/S13.2_A8_T1.js']
    },
    {
      id: 'CANT_IN_ARGUMENTS',
      description: 'Cannot "in" arguments on strict function',
      test: test_CANT_IN_ARGUMENTS,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=63398'],
      sections: ['11.8.7', '13.2', '13.2.3'],
      tests: ['test/language/statements/function/S13.2_A8_T2.js']
    },
    {
      id: 'STRICT_CALLER_NOT_POISONED',
      description: 'Strict "caller" not poisoned',
      test: test_STRICT_CALLER_NOT_POISONED,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,
      urls: [],
      sections: ['13.2'],
      tests: ['test/language/statements/function/S13.2.3_A1.js']
    },
    {
      id: 'STRICT_ARGUMENTS_NOT_POISONED',
      description: 'Strict "arguments" not poisoned',
      test: test_STRICT_ARGUMENTS_NOT_POISONED,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,
      urls: [],
      sections: ['13.2'],
      tests: ['test/language/statements/function/S13.2.3_A1.js']
    },
    {
      id: 'BUILTIN_LEAKS_CALLER',
      description: 'Built in functions leak "caller"',
      test: test_BUILTIN_LEAKS_CALLER,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,
      urls: ['https://code.google.com/p/v8/issues/detail?id=1643',
             'https://code.google.com/p/v8/issues/detail?id=1548',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=591846',
             'http://wiki.ecmascript.org/doku.php?id=' +
               'conventions:make_non-standard_properties_configurable'],
      sections: [],
      tests: ['https://github.com/tc39/test262/blob/b752d2fdde2d3a49619735ed3713f6c287667c6d/test/suite/bestPractice/Sbp_A10_T1.js']
    },
    {
      id: 'BUILTIN_LEAKS_ARGUMENTS',
      description: 'Built in functions leak "arguments"',
      test: test_BUILTIN_LEAKS_ARGUMENTS,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=1643',
             'https://code.google.com/p/v8/issues/detail?id=1548',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=591846',
             'http://wiki.ecmascript.org/doku.php?id=' +
               'conventions:make_non-standard_properties_configurable'],
      sections: [],
      tests: ['https://github.com/tc39/test262/blob/b752d2fdde2d3a49619735ed3713f6c287667c6d/test/suite/bestPractice/Sbp_A10_T2.js']
    },
    {
      id: 'BOUND_FUNCTION_LEAKS_CALLER',
      description: 'Bound functions leak "caller"',
      test: test_BOUND_FUNCTION_LEAKS_CALLER,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=893',
             'https://bugs.webkit.org/show_bug.cgi?id=63398'],
      sections: ['15.3.4.5'],
      tests: ['test/language/statements/function/S13.2.3_A1.js',
              'test/built-ins/Function/prototype/bind/S15.3.4.5_A1.js']
    },
    {
      id: 'BOUND_FUNCTION_LEAKS_ARGUMENTS',
      description: 'Bound functions leak "arguments"',
      test: test_BOUND_FUNCTION_LEAKS_ARGUMENTS,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=893',
             'https://bugs.webkit.org/show_bug.cgi?id=63398'],
      sections: ['15.3.4.5'],
      tests: ['test/language/statements/function/S13.2.3_A1.js',
              'test/built-ins/Function/prototype/bind/S15.3.4.5_A2.js']
    },
    {
      id: 'DELETED_BUILTINS_IN_OWN_NAMES',
      description: 'Deleting built-in leaves phantom behind',
      test: test_DELETED_BUILTINS_IN_OWN_NAMES,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=70207'],
      sections: ['15.2.3.4'],
      tests: []
    },
    {
      id: 'GETOWNPROPDESC_OF_ITS_OWN_CALLER_FAILS',
      description: 'getOwnPropertyDescriptor on its own "caller" fails',
      test: test_GETOWNPROPDESC_OF_ITS_OWN_CALLER_FAILS,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://code.google.com/p/v8/issues/detail?id=1769'],
      sections: ['13.2', '15.2.3.3'],
      tests: []
    },
    {
      id: 'JSON_PARSE_PROTO_CONFUSION',
      description: 'JSON.parse confused by "__proto__"',
      test: test_JSON_PARSE_PROTO_CONFUSION,
      repair: repair_JSON_PARSE_PROTO_CONFUSION,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=621',
             'https://code.google.com/p/v8/issues/detail?id=1310'],
      sections: ['15.12.2'],
      tests: ['test/built-ins/JSON/parse/S15.12.2_A1.js']
    },
    {
      id: 'PROTO_NOT_FROZEN',
      description: 'Prototype still mutable on non-extensible object',
      test: test_PROTO_NOT_FROZEN,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,  // No platform with this bug is fully repairable,
          // so it's not worth creating a repair for this bug.
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=65832',
             'https://bugs.webkit.org/show_bug.cgi?id=78438'],
      sections: ['8.6.2'],
      tests: ['test/language/types/object/S8.6.2_A8.js']
    },
    {
      id: 'PROTO_REDEFINABLE',
      description: 'Prototype still redefinable on non-extensible object',
      test: test_PROTO_REDEFINABLE,
      repair: void 0,
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: false,  // No platform with this bug is fully repairable,
          // so it's not worth creating a repair for this bug.
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=65832'],
      sections: ['8.6.2'],
      tests: ['test/language/types/object/S8.6.2_A8.js']
    },
    {
      id: 'DEFINING_READ_ONLY_PROTO_FAILS_SILENTLY',
      description: 'Defining __proto__ on non-extensible object fails silently',
      test: test_DEFINING_READ_ONLY_PROTO_FAILS_SILENTLY,
      repair: repair_DEFINE_PROPERTY,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=2441'],
      sections: ['8.6.2'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'DEFINE_PROPERTY_CONFUSES_FUNC_PROTO',
      description: 'Setting a function\'s prototype with defineProperty ' +
        'doesn\'t change its value',
      test: test_DEFINE_PROPERTY_CONFUSES_FUNC_PROTO,
      repair: repair_DEFINE_PROPERTY,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=3334'],
      sections: [],
      tests: []  // TODO(kpreid): contribute tests
    },
    {
      id: 'STRICT_EVAL_LEAKS_GLOBAL_VARS',
      description: 'Strict eval function leaks variable definitions',
      test: test_STRICT_EVAL_LEAKS_GLOBAL_VARS,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // No platform with this bug is fully repairable,
          // so it's not worth creating a repair for this bug.
      urls: ['https://code.google.com/p/v8/issues/detail?id=1624'],
      sections: ['10.4.2.1'],
      tests: ['test/language/eval-code/S10.4.2.1_A1.js']
    },
    {
      id: 'STRICT_EVAL_LEAKS_GLOBAL_FUNCS',
      description: 'Strict eval function leaks function definitions',
      test: test_STRICT_EVAL_LEAKS_GLOBAL_FUNCS,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // No platform with this bug is fully repairable,
          // so it's not worth creating a repair for this bug.
      urls: ['https://code.google.com/p/v8/issues/detail?id=1624'],
      sections: ['10.4.2.1'],
      tests: ['test/language/eval-code/S10.4.2.1_A1.js']
    },
    {
      id: 'EVAL_BREAKS_MASKING',
      description: 'Eval breaks masking of named functions in non-strict code',
      test: test_EVAL_BREAKS_MASKING,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // No platform with this bug is fully repairable,
          // so it's not worth creating a repair for this bug.
      urls: ['https://code.google.com/p/v8/issues/detail?id=2396'],
      sections: ['10.2'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'PARSEINT_STILL_PARSING_OCTAL',
      description: 'parseInt still parsing octal',
      test: test_PARSEINT_STILL_PARSING_OCTAL,
      repair: repair_PARSEINT_STILL_PARSING_OCTAL,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=1645'],
      sections: ['15.1.2.2'],
      tests: ['test/built-ins/parseInt/S15.1.2.2_A5.1_T1.js']
    },
    {
      id: 'STRICT_E4X_LITERALS_ALLOWED',
      description: 'E4X literals allowed in strict code',
      test: test_STRICT_E4X_LITERALS_ALLOWED,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,  // Not repairable without parsing
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=695577',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=695579'],
      sections: [],
      tests: []
    },
    {
      id: 'ASSIGN_CAN_OVERRIDE_FROZEN',
      description: 'Assignment can override frozen inherited property',
      test: test_ASSIGN_CAN_OVERRIDE_FROZEN,
      repair: repair_ASSIGN_CAN_OVERRIDE_FROZEN,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // We actually prefer the override behavior, and the
          // 'repair' sets a flag to take advantage of it.
      urls: ['https://code.google.com/p/v8/issues/detail?id=1169',
             'https://code.google.com/p/v8/issues/detail?id=1475',
             'https://mail.mozilla.org/pipermail/es-discuss/' +
               '2011-November/017997.html',
             'http://wiki.ecmascript.org/doku.php?id=strawman:' +
               'fixing_override_mistake'],
      sections: ['8.12.4'],
      tests: ['test/built-ins/Object/defineProperty/15.2.3.6-4-405.js']
    },
    {
      id: 'INCREMENT_IGNORES_FROZEN',
      description: 'Increment operators can mutate frozen properties',
      test: test_INCREMENT_IGNORES_FROZEN,
      repair: void 0,
      // NOTE: If mitigation by parsing/rewrite is available, we set
      // this to SAFE_SPEC_VIOLATION to allow SES initialization to
      // succeed, relying on the fact that startSES will use
      // mitigateGotchas.js to rewrite code to work around the
      // problem. Otherwise, the problem is NOT_OCAP_SAFE severity.
      //
      // TODO(ihab.awad): Build a better system to record problems of
      // unsafe severity that are known to be fixed by startSES using
      // mitigateSrcGotchas.
      preSeverity: canMitigateSrcGotchas ?
        severities.SAFE_SPEC_VIOLATION : severities.NOT_OCAP_SAFE,
      canRepair: false,  // Protection is based on rewriting, not repair
      urls: ['https://code.google.com/p/v8/issues/detail?id=2779'],
      sections: ['11.4.4', '8.12.4'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'POP_IGNORES_FROZEN',
      description: 'Array.prototype.pop ignores frozeness',
      test: test_POP_IGNORES_FROZEN,
      repair: repair_POP_IGNORES_FROZEN,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=75788'],
      sections: ['15.4.4.6'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'SORT_IGNORES_FROZEN',
      description: 'Array.prototype.sort ignores frozeness',
      test: test_SORT_IGNORES_FROZEN,
      repair: repair_SORT_IGNORES_FROZEN,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=2419'],
      sections: ['15.4.4.11'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'PUSH_IGNORES_SEALED',
      description: 'Array.prototype.push ignores sealing',
      test: test_PUSH_IGNORES_SEALED,
      repair: repair_ARRAY_LENGTH_MUTABLE,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=2412'],
      sections: ['15.4.4.11'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'PUSH_DOES_NOT_THROW_ON_FROZEN_ARRAY',
      description: 'Array.prototype.push does not throw on a frozen array',
      test: test_PUSH_DOES_NOT_THROW_ON_FROZEN_ARRAY,
      repair: repair_PUSH_IGNORES_SEALED,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=2711'],
      sections: ['15.2.3.9'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'PUSH_IGNORES_FROZEN',
      description: 'Array.prototype.push ignores frozen',
      test: test_PUSH_IGNORES_FROZEN,
      repair: repair_ARRAY_LENGTH_MUTABLE,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=2711'],
      sections: ['15.2.3.9'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'ARRAYS_DELETE_NONCONFIGURABLE',
      description: 'Setting [].length can delete non-configurable elements',
      test: test_ARRAYS_DELETE_NONCONFIGURABLE,
      repair: void 0,  // Not repairable
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=590690'],
      sections: ['15.4.5.2'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'ARRAY_LENGTH_MUTABLE',
      description: 'Freezing an array does not make .length immutable',
      test: test_ARRAY_LENGTH_MUTABLE,
      repair: repair_ARRAY_LENGTH_MUTABLE,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=2711'],
      sections: ['15.4.5.1'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'ARRAYS_MODIFY_READONLY',
      description: 'Extending an array can modify read-only array length',
      test: test_ARRAYS_MODIFY_READONLY,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Not repairable
      urls: ['https://code.google.com/p/v8/issues/detail?id=2379'],
      sections: ['15.4.5.1.3.f'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'CANT_REDEFINE_NAN_TO_ITSELF',
      description: 'Cannot redefine global NaN to itself',
      test: test_CANT_REDEFINE_NAN_TO_ITSELF,
      repair: repair_CANT_REDEFINE_NAN_TO_ITSELF,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: [], // Seen on WebKit Nightly. TODO(erights): report
      sections: ['8.12.9', '15.1.1.1'],
      tests: [] // TODO(jasvir): Add to test262
    },
    {
      id: 'FREEZE_IS_FRAME_DEPENDENT',
      description: 'Object.freeze falsely succeeds on other-frame objects',
      test: test_FREEZE_IS_FRAME_DEPENDENT,
      repair: repair_FREEZE_IS_FRAME_DEPENDENT,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Repair is useful but inadequate
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=784892',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=674195',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=789897'],
      sections: [],
      tests: []
    },
    {
      id: 'UNEXPECTED_ERROR_PROPERTIES',
      description: 'Error instances have unexpected properties',
      test: test_UNEXPECTED_ERROR_PROPERTIES,
      repair: void 0,
      preSeverity: severities.NEW_SYMPTOM,
      canRepair: false,  // Behavior of instances is not repairable
      urls: [],
      sections: [],
      tests: []
    },
    {
      id: 'ERRORS_HAVE_INVISIBLE_PROPERTIES',
      description: 'Error instances have invisible properties',
      test: test_ERRORS_HAVE_INVISIBLE_PROPERTIES,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // Long-dead bug, not worth keeping old repair around
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=726477',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=724768'],
      sections: [],
      tests: []
    },
    {
      id: 'STRICT_GETTER_BOXES',
      description: 'Strict getter must not box this, but does',
      test: test_STRICT_GETTER_BOXES,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // Not repairable without rewriting
      urls: ['https://bugs.ecmascript.org/show_bug.cgi?id=284',
             'https://bugs.webkit.org/show_bug.cgi?id=79843',
             'https://connect.microsoft.com/ie/feedback/details/727027',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=603201',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=732669'],
             // Opera DSK-358415
      sections: ['10.4.3'],
      tests: ['test/language/function-code/10.4.3-1-59-s.js']
    },
    {
      id: 'NON_STRICT_GETTER_DOESNT_BOX',
      description: 'Non-strict getter must box this, but does not',
      test: test_NON_STRICT_GETTER_DOESNT_BOX,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // Not repairable without rewriting
      urls: ['https://bugs.ecmascript.org/show_bug.cgi?id=284',
             'https://code.google.com/p/v8/issues/detail?id=1977',
             'https://bugzilla.mozilla.org/show_bug.cgi?id=732669'],
      sections: ['10.4.3'],
      tests: ['test/language/function-code/10.4.3-1-59-s.js']
    },
    {
      id: 'NONCONFIGURABLE_OWN_PROTO',
      description: 'All objects have non-configurable __proto__',
      test: test_NONCONFIGURABLE_OWN_PROTO,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // Behavior of instances is not repairable
      urls: ['https://code.google.com/p/v8/issues/detail?id=1310',
        'https://mail.mozilla.org/pipermail/es-discuss/2013-March/029177.html'],
      sections: [],  // Not spelled out in spec, according to Brendan Eich (see
                     // es-discuss link)
      tests: []  // TODO(jasvir): Add to test262 once we have a section to cite
    },
    {
      id: 'FREEZING_BREAKS_PROTOTYPES',
      description: 'Freezing Object.prototype breaks prototype setting',
      test: test_FREEZING_BREAKS_PROTOTYPES,
      repair: repair_FREEZING_BREAKS_PROTOTYPES,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=2565'],
      sections: ['15.2.3.5'],
      tests: []  // TODO(kpreid): find/add test262
    },
    {
      id: 'FREEZING_BREAKS_WEAKMAP',
      description: 'Freezing Object.prototype breaks WeakMap',
      test: test_FREEZING_BREAKS_WEAKMAP,
      repair: repair_FREEZING_BREAKS_WEAKMAP,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://code.google.com/p/v8/issues/detail?id=2829'],
      sections: [],  // TODO(kpreid): cite when ES6 is final
      tests: []  // TODO(kpreid): cite when ES6 is final
    },
    {
      id: 'THROWTYPEERROR_NOT_UNIQUE',
      description: '%ThrowTypeError% is not unique',
      test: test_THROWTYPEERROR_NOT_UNIQUE,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,
      urls: [],
      sections: [],
      tests: []
    },
    {
      id: 'THROWTYPEERROR_UNFROZEN',
      description: '%ThrowTypeError% is not frozen',
      test: test_THROWTYPEERROR_UNFROZEN,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,  // Note: Safe only because
          // startSES will do whitelist and defense; per spec intent it's an
          // undesired communication channel.
      canRepair: false,  // will be repaired by whitelist
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=108873'],
             // TODO(kpreid): find or file Firefox bug (writable props)
             // TODO(kpreid): find or file Chrome bug (has a .prototype)
      sections: ['13.2.3'],
      tests: []  // TODO(jasvir): Add to test262
    },
    {
      id: 'THROWTYPEERROR_PROPERTIES',
      description: '%ThrowTypeError% has normal function properties',
      test: test_THROWTYPEERROR_PROPERTIES,
      repair: void 0,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: false,  // will be repaired by whitelist
      urls: [],
             // WebKit is OK
             // TODO(kpreid): find or file Firefox bug (has writable props)
             // TODO(kpreid): find or file Chrome bug (has a .prototype!)
      sections: ['13.2.3'],
      tests: []  // TODO(jasvir): Add to test262
    },
    {
      id: 'SYNTAX_ERRORS_ARENT_ALWAYS_EARLY',
      description: 'SyntaxErrors aren\'t always early',
      test: test_SYNTAX_ERRORS_ARENT_ALWAYS_EARLY,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,  // Not repairable without parsing
      urls: ['https://code.google.com/p/v8/issues/detail?id=2728',
             'https://code.google.com/p/google-caja/issues/detail?id=1616'],
      sections: [],
      tests: []
    },
    {
      id: 'CANT_SAFELY_VERIFY_SYNTAX',
      description: 'Function constructor does not verify syntax',
      test: test_CANT_SAFELY_VERIFY_SYNTAX,
      // This does not repair Function but only ses.verifyStrictFunctionBody
      // (see above)
      repair: repair_CANT_SAFELY_VERIFY_SYNTAX,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: true,
      urls: ['https://code.google.com/p/google-caja/issues/detail?id=1616',
             'https://code.google.com/p/v8/issues/detail?id=2470',
             'https://bugs.webkit.org/show_bug.cgi?id=106160'],
      sections: ['15.3.2.1'],
      tests: []
    },
    {
      id: 'TYPED_ARRAYS_THROW_DOMEXCEPTION',
      description: 'Typed Array operations throw DOMException',
      test: test_TYPED_ARRAYS_THROW_DOMEXCEPTION,
      repair: repair_TYPED_ARRAYS_THROW_DOMEXCEPTION,
      // indirectly unsafe: DOMException is poisonous to WeakMaps on FF, so we
      // choose not to expose it, and un-whitelisted types do not get frozen by
      // startSES and are therefore global mutable state.
      preSeverity: severities.NOT_OCAP_SAFE,
      canRepair: true,
      urls: [],  // TODO(kpreid): file bugs if appropriate
      sections: ['13.2.3'],
      tests: []  // hopefully will be in ES6 tests
    },
    {
      id: 'TYPED_ARRAY_PROTOS_LOOK_UNFROZEN',
      description: 'Typed Array prototypes look unfrozen',
      test: test_TYPED_ARRAY_PROTOS_LOOK_UNFROZEN,
      repair: repair_TYPED_ARRAY_PROTOS_LOOK_UNFROZEN,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: [],  // TODO(kpreid): file bugs if appropriate
          // appears on Safari only
      sections: ['15.2.3.9', '15.2.3.12'],
      tests: []  // hopefully will be in ES6 tests
    },
    {
      id: 'NESTED_STRICT_FUNCTIONS_LEAK',
      description: 'Strict nested functions leak from block scope',
      test: test_NESTED_STRICT_FUNCTIONS_LEAK,
      repair: void 0,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: false,
      urls: ['https://connect.microsoft.com/IE/feedback/details/811124/ie11-javascript-function-scoping-is-weird-with-respect-to-functions-and-try-catch',
             'http://wiki.ecmascript.org/doku.php?id=conventions:recommendations_for_implementors'],
      sections: [],
      tests: []  // hopefully will be in ES6 tests
    },
    {
      id: 'NUMERIC_PROPERTIES_INVISIBLE',
      description: 'Numeric properties not reflectable on create()d objects',
      test: test_NUMERIC_PROPERTIES_INVISIBLE,
      repair: repair_NUMERIC_PROPERTIES_INVISIBLE,
      preSeverity: severities.UNSAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['http://webreflection.blogspot.co.uk/2014/04/all-ie-objects-are-broken.html'],
          // TODO(kpreid): link Microsoft info page when available
      sections: ['8.12.6'],
      tests: []  // TODO(kpreid): contribute tests
    },
    {
      id: 'GENERATORFUNCTION_CANNOT_BE_DENIED',
      description: 'Cannot deny access to unsafe %GeneratorFunction%',
      test: test_GENERATORFUNCTION_CANNOT_BE_DENIED,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,
      urls: ['https://code.google.com/p/google-caja/issues/detail?id=1953',
             'https://code.google.com/p/v8/issues/detail?id=3902',
             'https://code.google.com/p/chromium/issues/detail?id=460145',
             'https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorfunction.prototype.constructor'],
      sections: [],
      tests: []
    },
    {
      id: 'IMPORT_CAN_BE_EVALLED',
      description: 'Import statement evaluates outside module source text',
      test: test_IMPORT_CAN_BE_EVALLED,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,
      urls: [],
      sections: [],
      tests: []
    },
    {
      id: 'UNDERBAR_PROTO_GETTER_USES_GLOBAL',
      description: 'The getter of __proto__ coerces "this" to global',
      test: test_UNDERBAR_PROTO_GETTER_USES_GLOBAL,
      repair: repair_UNDERBAR_PROTO_accessors_USE_GLOBAL,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: true,
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=141865'],
      sections: [],
      tests: []
    },
    {
      id: 'UNDERBAR_PROTO_SETTER_USES_GLOBAL',
      description: 'The setter of __proto__ coerces "this" to global',
      test: test_UNDERBAR_PROTO_SETTER_USES_GLOBAL,
      repair: repair_UNDERBAR_PROTO_accessors_USE_GLOBAL,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: true,
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=141865'],
      sections: [],
      tests: []
    },
    {
      id: 'THROWING_THAWS_FROZEN_OBJECT',
      description: 'Throwing a frozen object opens a capability leak',
      test: test_THROWING_THAWS_FROZEN_OBJECT,
      repair: void 0,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: false,
      urls: ['https://bugs.webkit.org/show_bug.cgi?id=141871',
             'https://bugs.webkit.org/show_bug.cgi?id=141878'],
      sections: [],
      tests: []
    },
    {
      id: 'NON_EXTENSIBLES_EXTENSIBLE',
      description: 'Non-extensible objects can be extended',
      test: test_NON_EXTENSIBLES_EXTENSIBLE,
      repair: repair_NON_EXTENSIBLES_EXTENSIBLE,
      preSeverity: severities.NOT_ISOLATED,
      canRepair: true,
      urls: ['https://bugzilla.mozilla.org/show_bug.cgi?id=1125389',
             'https://code.google.com/p/google-caja/issues/detail?id=1954'],
      sections: [],
      tests: []
    },
    {
      id: 'MISSING_GET_OWN_PROPERTY_DESCRIPTORS',
      description: 'getOwnPropertyDescriptors is missing',
      test: test_MISSING_GET_OWN_PROPERTY_DESCRIPTORS,
      repair: repair_MISSING_GET_OWN_PROPERTY_DESCRIPTORS,
      preSeverity: severities.SAFE_SPEC_VIOLATION,
      canRepair: true,
      urls: ['https://github.com/ljharb/Object.getOwnPropertyDescriptors'],
      sections: [],
      tests: []
    }
  ];

  // SPLICE_PUT_IGNORES_FIRST_READONLY
  // SPLICE_PUT_DOESNT_THROW_FIRST_READONLY
  // SPLICE_PUT_IGNORES_FIRST_NON_WRITABLE
  // SPLICE_PUT_DOESNT_THROW_FIRST_NON_WRITABLE
  // SPLICE_PUT_IGNORES_LAST_READONLY
  // SPLICE_PUT_DOESNT_THROW_LAST_READONLY
  arrayPutProblem(supportedProblems,
                  'splice', [0, 0, 'a'], 0, 'a', 'readonly');
  arrayPutProblem(supportedProblems,
                  'splice', [0, 0, 'a'], 0, 'a', 'non_writable');
  arrayPutProblem(supportedProblems,
                  'splice', [1, 1], 1, void 0, 'readonly');

  // POP_PUT_IGNORES_LAST_READONLY
  // POP_PUT_DOESNT_THROW_LAST_READONLY
  arrayPutProblem(supportedProblems,
                  'pop', [], 1, void 0, 'readonly');

  // UNSHIFT_PUT_IGNORES_FIRST_READONLY
  // UNSHIFT_PUT_DOESNT_THROW_FIRST_READONLY
  // UNSHIFT_PUT_IGNORES_FIRST_NON_WRITABLE
  // UNSHIFT_PUT_DOESNT_THROW_FIRST_NON_WRITABLE
  arrayPutProblem(supportedProblems,
                  'unshift', ['a'], 0, 'a', 'readonly',
                  repair_UNSHIFT_IGNORES_READONLY);
  arrayPutProblem(supportedProblems,
                  'unshift', ['a'], 0, 'a', 'non_writable',
                  repair_UNSHIFT_IGNORES_READONLY);

  // SHIFT_PUT_IGNORES_FIRST_READONLY
  // SHIFT_PUT_DOESNT_THROW_FIRST_READONLY
  // SHIFT_PUT_IGNORES_FIRST_NON_WRITABLE
  // SHIFT_PUT_DOESNT_THROW_FIRST_NON_WRITABLE
  // SHIFT_PUT_IGNORES_LAST_READONLY
  // SHIFT_PUT_DOESNT_THROW_LAST_READONLY
  arrayPutProblem(supportedProblems,
                  'shift', [], 0, 'b', 'readonly',
                  repair_SHIFT_IGNORES_READONLY);
  arrayPutProblem(supportedProblems,
                  'shift', [], 0, 'b', 'non_writable',
                  repair_SHIFT_IGNORES_READONLY);
  arrayPutProblem(supportedProblems,
                  'shift', [], 1, void 0, 'readonly',
                  repair_SHIFT_IGNORES_READONLY);

  // REVERSE_PUT_IGNORES_FIRST_READONLY
  // REVERSE_PUT_DOESNT_THROW_FIRST_READONLY
  // REVERSE_PUT_IGNORES_FIRST_NON_WRITABLE
  // REVERSE_PUT_DOESNT_THROW_FIRST_NON_WRITABLE
  // REVERSE_PUT_IGNORES_LAST_READONLY
  // REVERSE_PUT_DOESNT_THROW_LAST_READONLY
  // REVERSE_PUT_IGNORES_LAST_NON_WRITABLE
  // REVERSE_PUT_DOESNT_THROW_LAST_NON_WRITABLE
  arrayPutProblem(supportedProblems,
                  'reverse', [], 0, 'b', 'readonly');
  arrayPutProblem(supportedProblems,
                  'reverse', [], 0, 'b', 'non_writable');
  arrayPutProblem(supportedProblems,
                  'reverse', [], 1, 'c', 'readonly');
  arrayPutProblem(supportedProblems,
                  'reverse', [], 1,  'c', 'non_writable');

  // SORT_PUT_IGNORES_FIRST_READONLY
  // SORT_PUT_DOESNT_THROW_FIRST_READONLY
  // SORT_PUT_IGNORES_FIRST_NON_WRITABLE
  // SORT_PUT_DOESNT_THROW_FIRST_NON_WRITABLE
  // SORT_PUT_IGNORES_LAST_READONLY
  // SORT_PUT_DOESNT_THROW_LAST_READONLY
  // SORT_PUT_IGNORES_LAST_NON_WRITABLE
  // SORT_PUT_DOESNT_THROW_LAST_NON_WRITABLE
  arrayPutProblem(supportedProblems,
                  'sort', [], 0, 'b', 'readonly');
  arrayPutProblem(supportedProblems,
                  'sort', [], 0, 'b', 'non_writable');
  arrayPutProblem(supportedProblems,
                  'sort', [], 1, 'c', 'readonly');
  arrayPutProblem(supportedProblems,
                  'sort', [], 1,  'c', 'non_writable');

  // UNSHIFT_IGNORES_SEALED
  // UNSHIFT_IGNORES_FROZEN
  // SPLICE_IGNORES_SEALED
  // SPLICE_IGNORES_FROZEN
  // SHIFT_IGNORES_SEALED
  // SHIFT_IGNORES_FROZEN
  arraySealProblem(supportedProblems, 'unshift', ['foo']);
  arraySealProblem(supportedProblems, 'splice', [0, 0, 'foo']);
  arraySealProblem(supportedProblems, 'shift', []);
  // Array.prototype.{push,pop,sort} are also subject to the problem
  // arraySealProblem handles, but are handled separately and more
  // precisely.

  // Note: GLOBAL_LEAKS_FROM_ARRAY_METHODS should be LAST in the list so as
  // to run its repair last, which reduces the number of chained wrapper
  // functions resulting from repairs.
  supportedProblems.push({
    id: 'GLOBAL_LEAKS_FROM_ARRAY_METHODS',
    description: 'Array methods as functions operate on global object',
    test: test_GLOBAL_LEAKS_FROM_ARRAY_METHODS,
    repair: repair_GLOBAL_LEAKS_FROM_ARRAY_METHODS,
    preSeverity: severities.NOT_ISOLATED,
    canRepair: true,
    urls: ['https://code.google.com/p/google-caja/issues/detail?id=1789',
           'https://code.google.com/p/v8/issues/detail?id=2758'],
    sections: ['15.4.4'],
    tests: [] // TODO(kpreid): Add to test262
  });

  ////////////////////// Testing, Repairing, Reporting ///////////

  ses._repairer.addPostTestKludge(function extraRepair() {
    if (Object.isFrozen && Object.isFrozen(Array.prototype.forEach)) {
      // Need to do it anyway, to repair the sacrificial freezing we
      // needed to do to test. Once we can permanently retire this
      // test, we can also retire the redundant repair.
      repair_NEED_TO_WRAP_FOREACH();
    }
  });

  try {
    strictForEachFn(baseProblems, ses._repairer.registerProblem);
    ses._repairer.testAndRepair();
    if (ses._repairer.okToLoad()) {
      strictForEachFn(supportedProblems, ses._repairer.registerProblem);
      ses._repairer.testAndRepair();
    }

    var reports = ses._repairer.getReports();

    // Made available to allow for later code reusing our diagnoses to work
    // around non-repairable problems in application-specific ways. startSES
    // will also expose this on cajaVM for unprivileged code.
    var indexedReports;
    try {
      indexedReports = Object.create(null);
    } catch (e) {
      // repair_FREEZING_BREAKS_PROTOTYPES does not support null
      indexedReports = {};
    }
    reports.forEach(function (report) {
      indexedReports[report.id] = report;
    });
    ses.es5ProblemReports = indexedReports;
  } catch (err) {
    ses._repairer.updateMaxSeverity(severities.NOT_SUPPORTED);
    var during = ses._repairer.wasDoing();
    logger.error('ES5 Repair ' + during + 'failed with: ', err);
  }

  logger.reportMax();

})(this);
