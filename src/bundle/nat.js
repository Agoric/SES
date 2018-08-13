// Copyright (C) 2011 Google Inc.
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

/**
 * Is allegenNum a number in the contiguous range of exactly and
 * unambiguously representable natural numbers (non-negative integers)?
 *
 * <p>See <a href=
 * "https://code.google.com/p/google-caja/issues/detail?id=1801"
 * >Issue 1801: Nat must include at most (2**53)-1</a>
 * and <a href=
 * "https://mail.mozilla.org/pipermail/es-discuss/2013-July/031716.html"
 * >Allen Wirfs-Brock's suggested phrasing</a> on es-discuss.
 */
export function Nat(allegedNum) {
  // TODO simplify by using Number.isSafeInteger
  if (typeof allegedNum !== 'number') {
    throw new RangeError('not a number');
  }
  if (allegedNum !== allegedNum) { throw new RangeError('NaN not natural'); }
  if (allegedNum < 0)            { throw new RangeError('negative'); }
  if (allegedNum % 1 !== 0)      { throw new RangeError('not integral'); }
  if (allegedNum > Number.MAX_SAFE_INTEGER) { throw new RangeError('too big'); }
  return allegedNum;
}
