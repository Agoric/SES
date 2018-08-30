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

import {insist} from './insist';
import {def} from './ses';

/**
 * Wraps WeakMap to provide a less hazardous form of the WeakMap model
 * of private state.
 *
 * 
 *
 * A fieldMap differs from a weakMap in a number of ways:

 *    * To protect against confused deputy confusion, a field goes
 *      through a lifecycle of being registered, then initialized,
 *      then any numbers of gets and sets. Normally a field gets
 *      registered and initialized at the same time.

 *    * When registration and initialization are separated, a
 *      registered binding is in a temporal dead zone where it can
 *      only be initialized or brand tested. This temporal dead zone
 *      mirrors the semantics of variables defined by `let` and
 *      `const`.

 *    * 
 */
export function makeFieldMap(iterable = undefined) {
  // assert: wm cannot escape.
  const wm = new WeakMap(iterable);
  
  // assert: pumpkin cannot escape.
  const pumpkin = def({});

  // Register a previously unregistered binding. If an initialValue is
  // provided, also initialize the binding to that value.
  const register = (key, initialValue = pumpkin) => {
    insist(!wm.has(key),
           `${key} must not yet be registered`);
    wm.set(key, initialValue);
  };

  // Initialize a registered but uninitialized binding.
  const init = (key, initialValue) => {
    insist(wm.has(key),
           `${key} must first be registered`);
    insist( wm.get(key) === pumpkin,
            `${key} must not yet be initialized`);
    wm.set(key, initialValue);
  };

  // brand test. A registered binding passed the brand test whether or
  // not it is initialized yet.
  const has = (key) => wm.has(key);

  // get the current value of a registered and initialized binding.
  const get = (key) => {
    insist(wm.has(key),
           `${key} must first be registered`);
    const result = wm.get(key);
    insist(result !== pumpkin,
           `${key} must first be initialized`);
    return result;
  };

  // update the current value of a registered and initialized binding.
  const set = (key, value) => {
    insist(wm.has(key),
           `${key} must first be registered`);
    insist(wm.get(key) !== pumpkin,
           `${key} must first be initialized`);
    wm.set(key, value);
    return fieldMap;
  };

  const readOnlyView = () => roView;

  const roView = ({ has, get, readOnlyView });
  const fieldMap = ({ register, init, set, ...roView });
  return fieldMap;
}
