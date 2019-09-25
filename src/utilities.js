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

export function allowed(option) {
  return option === 'allow';
}

export function objectCloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function arrayCloneShallow(arr) {
  // shallow copy into a new array object
  return arr.slice(0);
}

export function objectFilter(obj, filter) {
  if (typeof filter !== 'function') {
    throw new TypeError('not a function');
  }
  const result = {};
  // Copy properties and symbols.
  Reflect.ownKeys(obj).forEach(key => {
    if (filter(key)) {
      result[key] = obj[key];
    }
  });
  return result;
}
