// Copyright (C) 2018 Agoric
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import makeHardener from '@agoric/make-hardener';
import Evaluator from '../evaluator-shim/src/main';

import tameDate from './bundle/tame-date';
import tameMath from './bundle/tame-math';
import tameIntl from './bundle/tame-intl';
import tameError from './bundle/tame-error';
import tameRegExp from './bundle/tame-regexp';
import removeProperties from './bundle/removeProperties';
import getAnonIntrinsics from './bundle/anonIntrinsics';
import getNamedIntrinsics from './bundle/namedIntrinsics';
import getAllPrimordials from './bundle/getAllPrimordials';
import getAllIntrinsics from './bundle/getAllIntrinsics';
import defaultWhitelist from './bundle/whitelist';
// import makeConsole from './bundle/make-console';
// import makeMakeRequire from './bundle/make-require';
import defaultDataPropertiesToRepair from './bundle/dataPropertiesToRepair';
import repairDataProperties from './bundle/repairDataProperties';
import repairFunctionConstructors from './bundle/repairFunctionConstructors';
import repairLegacyAccessors from './bundle/repairLegacyAccessors';

import { getUnsafeGlobal } from './unsafeGlobal';
import {
  allowed,
  objectCloneDeep,
  objectFilter,
  arrayCloneShallow,
} from './utilities';

const FORWARDED_EVALUATORS_OPTIONS = ['transforms'];

// Remove 'lockdown'
// todo: maybe provide a blacklist to remove additional properties
// can't use a whitelist because shims might add additional properties
// we can't think of anything sensible to remove other than 'lockdown'
const BLACKLISTED_GLOBALS = ['lockdown'];

function sanitizeOptions(options) {
  // Extract arrays of functions
  const shims = arrayCloneShallow(options.shims);
  const transforms = arrayCloneShallow(options.transforms);

  // Everything is plain objects/arrays/primitives
  const opt = objectCloneDeep(options);

  // Re-attach the sanitized values.
  opt.shims = shims;
  opt.transforms = transforms;

  // Attach clones of defaults.
  if (!opt.dataPropertiesToRepair) {
    opt.dataPropertiesToRepair = objectCloneDeep(defaultDataPropertiesToRepair);
  }
  if (!opt.whitelist) {
    // clone to allow additions/removals
    opt.whitelist = objectCloneDeep(defaultWhitelist);
  }

  return opt;
}

export default function lockdown(rootSrc, options = {}) {
  // Sanitize options first, overriding the original argument
  // object to make original values unavailable.
  // todo: consider more sanitization
  options = sanitizeOptions(options);

  // this 'global' defines the objects we're making safe
  const unsafeGlobal = getUnsafeGlobal();

  // ---------------------
  // 1. REPAIR (mandatory)
  // ---------------------

  // Repairs to maintain confinement (prevent
  // access to the global object)
  repairLegacyAccessors();
  repairFunctionConstructors();

  // ----------------------
  // 2. TAME (reduce power, optional)
  // ----------------------

  // "allow" enables real Date.now(), anything else gets NaN
  // (it'd be nice to allow a fixed numeric value, but too hard to
  // implement right now)
  if (!allowed(options.dateNowMode)) {
    tameDate();
  }

  if (!allowed(options.mathRandomMode)) {
    tameMath();
  }

  // Intl is disabled entirely for now, deleted by removeProperties. If we
  // want to bring it back (under the control of this option), we'll need
  // to add it to the whitelist too, as well as taming it properly.
  if (!options.intlMode) {
    // this shim also disables Object.prototype.toLocaleString
    tameIntl();
  } else {
    /*
      options.whitelist.namedIntrinsics.Intl = {
        Collator: true,
        DateTimeFormat: true,
        NumberFormat: true,
        PluralRules: true,
        getCanonicalLocales: true
      }
    */
  }

  if (!allowed(options.errorStackMode)) {
    tameError();
  } else {
    // if removeProperties cleans these things from Error, v8 won't provide
    // stack traces or even toString on exceptions, and then Node.js prints
    // uncaught exceptions as "undefined" instead of a type/message/stack.
    // So if we're allowing stack traces, make sure the whitelist is
    // augmented to allow/include them.
    options.whitelist.namedIntrinsics.Error.captureStackTrace = true;
    options.whitelist.namedIntrinsics.Error.stackTraceLimit = true;
    options.whitelist.namedIntrinsics.Error.prepareStackTrace = true;
  }

  if (!allowed(options.regexpMode)) {
    tameRegExp();
  }

  // ----------------------
  // 3. REMOVE (remove non-standard properties)
  // ----------------------

  removeProperties(unsafeGlobal, options.whitelist);

  // ---------------------
  // 4. SHIM (add new objects/correct exisiting behavior)
  // ---------------------

  for (const shim of options.shims) {
    shim();
  }

  // ---------------------
  // 5. HARDEN (freeze)
  // ---------------------

  // Extract the intrinsics from the global.
  const anonIntrinsics = getAnonIntrinsics(unsafeGlobal);
  const namedIntrinsics = getNamedIntrinsics(unsafeGlobal, options.whitelist);

  // Gather the intrinsics only.
  const allIntrinsics = getAllIntrinsics(namedIntrinsics, anonIntrinsics);

  // Gather the primordials and the globals.
  const allPrimordials = getAllPrimordials(unsafeGlobal, anonIntrinsics);

  // Repair the override mistake on selected intrinsics only.
  repairDataProperties(allIntrinsics, options.dataPropertiesToRepair);

  // Build a harden() with an empty fringe. It will be populated later when
  // we call harden(allIntrinsics).
  const harden = makeHardener();

  // Finally freeze all the primordials, and the global object. This must
  // be the last thing we do that modifies the Realm's globals.
  harden(allPrimordials);

  // ---------------------
  // EVALUATOR
  // ---------------------

  // Forward the designated Evaluators options.
  const filteredOptions = objectFilter(options, name => {
    return FORWARDED_EVALUATORS_OPTIONS.include(name);
  });

  const evaluator = new Evaluator(filteredOptions);

  // ---------------------
  // GLOBAL OBJECT
  // ---------------------

  const descs = Object.getOwnPropertyDescriptors(unsafeGlobal);
  const filteredGlobals = objectFilter(descs, name => {
    return !BLACKLISTED_GLOBALS.include(name);
  });
  Object.defineProperties(evaluator.global, filteredGlobals);

  return evaluator.evaluate(rootSrc);
}
