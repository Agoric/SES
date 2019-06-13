import { parse } from '@agoric/babel-parser';
import generate from '@babel/generator';

export default function makeRewriteEvaluator(baseEval, options) {
  const { infixBangResolver } = options;
  if (!infixBangResolver) {
    return baseEval;
  }
  const parserPlugins = [];
  if (infixBangResolver !== undefined) {
    parserPlugins.push(['infixBang', { resolver: infixBangResolver }]);
  }
  const transform = str => {
    const ast = parse(str, {
      plugins: parserPlugins,
    });
    // TODO: add source map options?
    const gen = generate(ast, {}, str);
    return gen.code;
  };

  // FIXME: This needs the cooperation of the globals proxy to detect direct eval.
  const rewriteEvaluate = (src, endowments, origEndowments) => {
    const newEndowments = {
      ...(endowments || {}),
      eval: src2 => rewriteEvaluate(src2, origEndowments, origEndowments),
    };
    const newSrc = transform(src);
    return baseEval(newSrc, newEndowments);
  };
  return (src, endowments) => rewriteEvaluate(src, endowments, endowments);
}
