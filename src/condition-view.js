import { h, put, warn } from './ui.js';
import { toTree, words } from './conditions.js';
import { json } from './roles.js';
export function conditionView(flat) {
  try {
    const draw = (node, name) => h('li', words(node, name), node.children.length > 0 && h('ul', node.children.map((child, i) => draw(child, [1,2,3].includes(node.operator) ? name : 'Parameter ' + (i + 1)))));
    return h('div', h('ul', draw(toTree(flat), 'Call data')), h('details', h('summary', 'Exact conditions'), h('pre', json(flat))));
  } catch (e) { return h('div', warn(e.message), h('pre', json(flat))); }
}
