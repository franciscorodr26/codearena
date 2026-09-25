/**
 * Problem input shapes: what the harness actually hands a candidate's function.
 *
 * The question bank stores every input as JSON. A binary tree is a level-order array with
 * null marking a missing child, an N-ary tree is a level-order array with null separating
 * sibling groups, and a linked list is an array of values. For almost every problem the
 * harness passes that array through untouched: it does NOT build TreeNode or ListNode
 * objects. Only the three problems in HARNESS_NODE_PROBLEMS get real nodes, and only in
 * the languages listed there.
 *
 * This file is the single source of truth for that contract. Both halves of the platform
 * read it, so a candidate's starter code can never promise a type the grader will not pass:
 *   - frontend/utils/functionTemplates.js types the starter signature from it
 *   - backend/services/codeWrapper.js keeps structure-carrying arguments nullable from it
 *
 * Before this existed, functionTemplates.js guessed from the problem description: any
 * one-parameter problem whose text mentioned "tree" was given a `root: TreeNode` parameter.
 * The harness passed an array, so `root.val` raised AttributeError and a correct solution
 * failed every test case. That is what this registry prevents.
 *
 * Enforced by backend/services/__tests__/problemInputShapes.test.js, which walks the whole
 * bank and fails if a starter's declared parameter types disagree with the arguments the
 * wrapper emits, or if a starter names a node class the harness will not construct.
 *
 * Shapes:
 *   'value'        plain JSON value, passed through untouched
 *   'binary-tree'  level-order array, null marks a missing child (may contain nulls)
 *   'n-ary-tree'   level-order array, null separates sibling groups (may contain nulls)
 *   'linked-list'  array of node values (no nulls)
 */

const BT = 'binary-tree';
const NT = 'n-ary-tree';
const LL = 'linked-list';
const V = 'value';

const PROBLEM_INPUT_SHAPES = {
  // ---- easy ----
  'merge-two-sorted-lists': { params: [LL, LL], returns: LL },
  'reverse-linked-list': { params: [LL], returns: LL },
  'max-depth-binary-tree': { params: [BT], returns: V },
  'invert-binary-tree': { params: [BT], returns: BT },
  'symmetric-tree': { params: [BT], returns: V },
  'same-tree': { params: [BT, BT], returns: V },
  'palindrome-linked-list': { params: [LL], returns: V },
  'diameter-of-binary-tree': { params: [BT], returns: V },
  'balanced-binary-tree': { params: [BT], returns: V },
  'subtree-of-another-tree': { params: [BT, BT], returns: V },
  'middle-linked-list': { params: [LL], returns: V },
  'path-sum': { params: [BT, V], returns: V },
  'min-depth-binary-tree': { params: [BT], returns: V },
  'convert-binary-linked-list': { params: [LL], returns: V },
  'univalued-binary-tree': { params: [BT], returns: V },
  'leaf-similar-trees': { params: [BT, BT], returns: V },
  'sum-root-to-leaf': { params: [BT], returns: V },
  'cousins-binary-tree': { params: [BT, V, V], returns: V },
  'increasing-order-bst': { params: [BT], returns: BT },
  'binary-tree-paths': { params: [BT], returns: V },
  'sum-left-leaves': { params: [BT], returns: V },
  'merge-two-binary-trees': { params: [BT, BT], returns: BT },
  'average-levels-tree': { params: [BT], returns: V },
  'n-ary-tree-preorder': { params: [NT], returns: V },
  'n-ary-tree-postorder': { params: [NT], returns: V },
  'max-depth-n-ary': { params: [NT], returns: V },
  'sorted-array-to-bst': { params: [V], returns: BT },
  'min-absolute-diff-bst': { params: [BT], returns: V },
  'find-mode-bst': { params: [BT], returns: V },
  'two-sum-iv-bst': { params: [BT, V], returns: V },
  'increasing-bst': { params: [BT], returns: BT },
  'min-diff-bst-nodes': { params: [BT], returns: V },
  'range-sum-bst': { params: [BT, V, V], returns: V },

  // ---- medium ----
  'binary-tree-level-order': { params: [BT], returns: V },
  'validate-bst': { params: [BT], returns: V },
  'lowest-common-ancestor': { params: [BT, V, V], returns: V },
  'kth-smallest-bst': { params: [BT, V], returns: V },
  'construct-binary-tree': { params: [V, V], returns: BT },
  'add-two-numbers-linked-list': { params: [LL, LL], returns: LL },
  'remove-nth-node-end': { params: [LL, V], returns: LL },
  'odd-even-linked-list': { params: [LL], returns: LL },
  'count-good-nodes-binary-tree': { params: [BT], returns: V },
  'binary-tree-right-side-view': { params: [BT], returns: V },
  'reorder-list': { params: [LL], returns: LL },
  'remove-duplicates-sorted-list-ii': { params: [LL], returns: LL },
  'serialize-deserialize-bst': { params: [BT], returns: BT },
  'construct-bst-from-preorder': { params: [V], returns: BT },
  'unique-binary-search-trees-ii': { params: [V], returns: 'binary-tree[]' },
  'binary-tree-zigzag': { params: [BT], returns: V },
  'construct-binary-tree-inorder-postorder': { params: [V, V], returns: BT },
  'path-sum-ii': { params: [BT, V], returns: V },
  'populating-next-right-pointers': { params: [BT], returns: BT },
  'sum-root-to-leaf-numbers': { params: [BT], returns: V },
  'count-complete-tree-nodes': { params: [BT], returns: V },
  'house-robber-iii': { params: [BT], returns: V },
  'delete-node-bst': { params: [BT, V], returns: BT },
  'inorder-successor-bst': { params: [BT, V], returns: V },
  'recover-binary-search-tree': { params: [BT], returns: BT },
  'trim-binary-search-tree': { params: [BT, V, V], returns: BT },
  'convert-sorted-list-to-bst': { params: [LL], returns: BT },
  'convert-sorted-list-bst': { params: [LL], returns: BT },
  'sort-list': { params: [LL], returns: LL },
  'flatten-binary-tree-to-linked-list': { params: [BT], returns: BT },
  'distribute-coins-in-binary-tree': { params: [BT], returns: V },
  'all-nodes-distance-k': { params: [BT, V, V], returns: V },
  'remove-nth-from-end': { params: [LL, V], returns: LL },
  'add-two-numbers-list': { params: [LL, LL], returns: LL },
  'rotate-list': { params: [LL, V], returns: LL },
  'swap-nodes-pairs': { params: [LL], returns: LL },
  'lca-binary-tree': { params: [BT, V, V], returns: V },
  'construct-tree-preorder-inorder': { params: [V, V], returns: BT },
  'path-sum-iii': { params: [BT, V], returns: V },
  'delete-node-linked-list': { params: [LL, V], returns: LL },
  'construct-from-preorder': { params: [V], returns: BT },
  'find-bottom-left': { params: [BT], returns: V },
  'n-ary-tree-level-order': { params: [NT], returns: V },
  'max-binary-tree': { params: [V], returns: BT },
  'print-binary-tree': { params: [BT], returns: V },
  'find-duplicate-subtrees': { params: [BT], returns: 'binary-tree[]' },
  'split-linked-list': { params: [LL, V], returns: 'linked-list[]' },
  'add-one-row-tree': { params: [BT, V, V], returns: BT },
  'maximum-level-sum': { params: [BT], returns: V },
  'delete-nodes-return-forest': { params: [BT, V], returns: 'binary-tree[]' },
  'flip-binary-tree-to-match-preorder': { params: [BT, V], returns: V },
  'bst-to-gst': { params: [BT], returns: BT },
  'max-average-subtree': { params: [BT], returns: V },
  'longest-zigzag-path': { params: [BT], returns: V },
  'linked-list-in-binary-tree': { params: [LL, BT], returns: V },
  'linked-list-random-node': { params: [LL], returns: V },
  'convert-bst-to-dll': { params: [BT], returns: V },
  'boundary-of-binary-tree': { params: [BT], returns: V },
  'step-by-step-directions': { params: [BT, V, V], returns: V },
  'closest-nodes-bst': { params: [BT, V], returns: V },
  'amount-of-time-for-binary-tree-infected': { params: [BT, V], returns: V },

  // ---- hard ----
  'serialize-deserialize-tree': { params: [BT], returns: BT },
  'reverse-nodes-k-group': { params: [LL, V], returns: LL },
  'binary-tree-max-path-sum': { params: [BT], returns: V },
  'binary-tree-cameras': { params: [BT], returns: V },
  'vertical-order-traversal': { params: [BT], returns: V },
  'serialize-deserialize-n-ary': { params: [NT], returns: NT },
};


/** Shapes that describe a linked structure rather than a plain value. */
const STRUCTURE_SHAPES = ['binary-tree', 'n-ary-tree', 'linked-list'];

/** Shapes whose array form can legitimately contain nulls, so their literals stay nullable. */
const NULLABLE_SHAPES = ['binary-tree', 'n-ary-tree'];

/**
 * The only problems where the harness builds real node objects, and the only languages
 * where it does. codeWrapper.js implements these through `special:` in PROBLEM_CONFIG;
 * every other language falls through to the plain-array path, so its starter must not
 * mention ListNode.
 */
const HARNESS_NODE_PROBLEMS = {
  'merge-two-sorted-lists': { className: 'ListNode', languages: ['python', 'javascript', 'typescript'] },
  'reverse-linked-list': { className: 'ListNode', languages: ['python', 'javascript', 'typescript'] },
  'sort-list': { className: 'ListNode', languages: ['python', 'javascript', 'typescript'] },
};

/** Node class names that must never appear in a starter unless the harness constructs them. */
const NODE_CLASS_NAMES = ['TreeNode', 'ListNode'];

function getProblemInputShape(problemId) {
  return PROBLEM_INPUT_SHAPES[problemId] || null;
}

function isStructureShape(shape) {
  return STRUCTURE_SHAPES.includes(shape);
}

/** True when this problem's array form for the given parameter may contain nulls. */
function shapeIsNullable(shape) {
  return NULLABLE_SHAPES.includes(shape);
}

/**
 * The node class the harness will really construct for this problem in this language,
 * or null when it passes plain arrays (the overwhelmingly common case).
 */
function harnessNodeClass(problemId, language) {
  const entry = HARNESS_NODE_PROBLEMS[problemId];
  if (!entry || !entry.languages.includes(language)) return null;
  return entry.className;
}

/**
 * Shape of a specific parameter, or 'value' when the problem is not in the registry.
 * Returns null for a structure parameter whose harness builds real nodes, since the
 * caller should use harnessNodeClass for those.
 */
function parameterShape(problemId, index) {
  const shape = getProblemInputShape(problemId);
  if (!shape || index >= shape.params.length) return 'value';
  return shape.params[index];
}

function returnShape(problemId) {
  const shape = getProblemInputShape(problemId);
  return shape ? shape.returns : 'value';
}

module.exports = {
  PROBLEM_INPUT_SHAPES,
  STRUCTURE_SHAPES,
  NULLABLE_SHAPES,
  HARNESS_NODE_PROBLEMS,
  NODE_CLASS_NAMES,
  getProblemInputShape,
  isStructureShape,
  shapeIsNullable,
  harnessNodeClass,
  parameterShape,
  returnShape,
};
