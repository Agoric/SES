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

import Evaluator from 'compartment-shim';
import makeHardener from '@agoric/make-hardener';
import tameDate from './tame-date';
import tameMath from './tame-math';
import tameIntl from './tame-intl';
import tameError from './tame-error';
import tameRegExp from './tame-regexp';
import removeProperties from './removeProperties';
import getAnonIntrinsics from './anonIntrinsics';
import getNamedIntrinsics from './namedIntrinsics';
import getAllPrimordials from './getAllPrimordials';
import getAllIntrinsics from './getAllIntrinsics';
import whitelist from './whitelist';
import makeConsole from './make-console';
import makeMakeRequire from './make-require';
import dataPropertiesToRepair from './dataPropertiesToRepair';
import repairDataProperties from './repairDataProperties';
import repairFunctionConstructors from './repairFunctionConstructors';
import repairLegacyAccessors from './repairLegacyAccessors';

const FORWARDED_EVALUATORS_OPTIONS = ['transforms'];

// this 'global' defines the objects we're making safe
const unsafeGlobal = this;

export function lockdown(rootSrc, options = {}) {
  // eslint-disable-next-line no-param-reassign
  options = Object(options); // Todo: sanitize
  const shims = [];

  const {
    dataPropertiesToRepair: optDataPropertiesToRepair,
    shims: optionalShims,
    whitelist: optWhitelist,
    ...optionsRest
  } = options;

  const wl = JSON.parse(JSON.stringify(optWhitelist || whitelist));
  const repairPlan =
        optDataPropertiesToRepair !== undefined
        ? JSON.parse(JSON.stringify(optDataPropertiesToRepair))
        : dataPropertiesToRepair;

  // Forward the designated Evaluators options.
  const evaluatorsOptions = {};
  FORWARDED_EVALUATORS_OPTIONS.forEach(key => {
    if (key in optionsRest) {
      evaluatorsOptions[key] = optionsRest[key];
    }
  });

  // "allow" enables real Date.now(), anything else gets NaN
  // (it'd be nice to allow a fixed numeric value, but too hard to
  // implement right now)
  if (options.dateNowMode !== 'allow') {
    shims.push(tameDate);
  }

  if (options.mathRandomMode !== 'allow') {
    shims.push(tameMath);
  }

  // Intl is disabled entirely for now, deleted by removeProperties. If we
  // want to bring it back (under the control of this option), we'll need
  // to add it to the whitelist too, as well as taming it properly.
  if (options.intlMode !== 'allow') {
    // this shim also disables Object.prototype.toLocaleString
    shims.push(tameIntl);
  } else {
    /*
      wl.namedIntrinsics.Intl = {
        Collator: true,
        DateTimeFormat: true,
        NumberFormat: true,
        PluralRules: true,
        getCanonicalLocales: true
      }
    */
  }

  if (options.errorStackMode !== 'allow') {
    shims.push(tameError);
  } else {
    // if removeProperties cleans these things from Error, v8 won't provide
    // stack traces or even toString on exceptions, and then Node.js prints
    // uncaught exceptions as "undefined" instead of a type/message/stack.
    // So if we're allowing stack traces, make sure the whitelist is
    // augmented to include them.
    wl.namedIntrinsics.Error.captureStackTrace = true;
    wl.namedIntrinsics.Error.stackTraceLimit = true;
    wl.namedIntrinsics.Error.prepareStackTrace = true;
  }

  if (options.regexpMode !== 'allow') {
    shims.push(tameRegExp);
  }
  
  shims.push(() => removeProperties(unsafeGlobal, wl));

  // Add options.shims.
  if (optionalShims) {
    shims.push(...optionalShims);
  }

  // Build a harden() with an empty fringe. It will be populated later when
  // we call harden(allIntrinsics).
  const harden = makeHardener();

  // Extract the intrinsics from the global.
  const anonIntrinsics = getAnonIntrinsics(unsafeGlobal);
  const namedIntrinsics = getNamedIntrinsics(unsafeGlobal, whitelist);

  // Gather the intrinsics only.
  const allIntrinsics = getAllIntrinsics(namedIntrinsics, anonIntrinsics);

  // Gather the primordials and the globals.
  const allPrimordials = getAllPrimordials(unsafeGlobal, anonIntrinsics);

  // TODO: confirm ordering
  repairFunctionConstructors();
  repairLegacyAccessors();

  for (let shim of shims) {
    shim();
  }

  // Repair the override mistake on the intrinsics only.
  repairDataProperties(allIntrinsics, repairPlan);

  // Finally freeze all the primordials, and the global object. This must
  // be the last thing we do that modifies the Realm's globals.
  harden(allPrimordials);

  const e = new Evaluator(evaluatorsOptions);
  function filterGlobals(name) {
    // remove 'lockdown'
    // maybe provide a blacklist to remove additional properties
    // can't use a whitelist because shims might add additional properties
    // we can't think of anything sensible to remove other than 'lockdown'
    return !(name === 'lockdown');
  }
  Object.defineProperties(e.global,
                          Object.getOwnPropertyDescriptors(unsafeGlobal).filter(filterGlobals));
  // e.global.require cannot accept relative pathnames, but subsequent
  // requires() can
  
  return e.evaluate(rootSrc);
}
