/**
 * rehype-base-path
 *
 * Markdown内の絶対パスリンク（/で始まるもの）に
 * astro.config.mjsのbaseパスを自動付与するrehypeプラグイン
 *
 * 例: base: '/dwhbi' の場合
 *   /100-development/... → /dwhbi/100-development/...
 */

import { visit } from 'unist-util-visit';

/**
 * @param {Object} options
 * @param {string} options.base - ベースパス（例: '/dwhbi'）
 */
export function rehypeBasePath(options = {}) {
  const base = options.base || '';

  // baseが空または'/'のみの場合は何もしない
  if (!base || base === '/') {
    return (tree) => tree;
  }

  // baseの末尾スラッシュを削除（重複防止）
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;

  return (tree) => {
    visit(tree, 'element', (node) => {
      // aタグのhref属性を処理
      if (node.tagName === 'a' && node.properties?.href) {
        const href = node.properties.href;

        // 条件:
        // - /で始まる（絶対パス）
        // - //で始まらない（プロトコル相対URL）
        // - 既にbaseパスが付いていない
        if (
          typeof href === 'string' &&
          href.startsWith('/') &&
          !href.startsWith('//') &&
          !href.startsWith(normalizedBase)
        ) {
          node.properties.href = normalizedBase + href;
        }
      }

      // imgタグのsrc属性も処理（必要に応じて）
      if (node.tagName === 'img' && node.properties?.src) {
        const src = node.properties.src;

        if (
          typeof src === 'string' &&
          src.startsWith('/') &&
          !src.startsWith('//') &&
          !src.startsWith(normalizedBase)
        ) {
          node.properties.src = normalizedBase + src;
        }
      }
    });
  };
}

export default rehypeBasePath;
