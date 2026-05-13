'use strict';

function isTraced(node) {
  if (node.decorators && node.decorators.some((d) => d.expression && d.expression.name === 'traced')) {
    return true;
  }

  let container = node.parent;
  let classNode = node;
  // export default class wraps the ClassDeclaration in ExportDefaultDeclaration
  if (container && container.type === 'ExportDefaultDeclaration') {
    classNode = container;
    container = container.parent;
  }
  if (!container || !container.body) {
    return false;
  }
  const siblings = container.body;
  const idx = siblings.indexOf(classNode);
  for (let i = idx + 1; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (
      sibling.type === 'ExpressionStatement' &&
      sibling.expression &&
      sibling.expression.type === 'CallExpression' &&
      sibling.expression.callee &&
      sibling.expression.callee.name === 'traced' &&
      sibling.expression.arguments.length === 1 &&
      sibling.expression.arguments[0].name === node.id?.name
    ) {
      return true;
    }
    if (sibling.type === 'ClassDeclaration' || sibling.type === 'FunctionDeclaration') {
      break;
    }
  }
  return false;
}

module.exports = {
  'no-arrow-in-traced': {
    meta: {
      type: 'problem',
      docs: {
        description: 'Disallow arrow function class fields in @traced classes',
      },
      messages: {
        noArrowInTraced:
          'Arrow function class fields are not traced by the @traced decorator. Convert to a regular method.',
      },
    },
    create(context) {
      return {
        ClassDeclaration(node) {
          if (!isTraced(node)) {
            return;
          }
          for (const member of node.body.body) {
            if (
              member.type === 'PropertyDefinition' &&
              member.value &&
              member.value.type === 'ArrowFunctionExpression'
            ) {
              context.report({ node: member, messageId: 'noArrowInTraced' });
            }
          }
        },
      };
    },
  },
};
