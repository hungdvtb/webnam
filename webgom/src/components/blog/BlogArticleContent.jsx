'use client';

import { useMemo } from 'react';
import { buildBlogContentMarkup } from '@/lib/blogContent';
import BlogMediaGalleryEnhancer from '@/components/blog/BlogMediaGalleryEnhancer';

function joinClassNames(...items) {
  return items.filter(Boolean).join(' ');
}

export default function BlogArticleContent({
  html = '',
  className = '',
  contentKey = '',
}) {
  const rawHtml = typeof html === 'string' ? html : '';
  const contentMarkup = useMemo(() => buildBlogContentMarkup(rawHtml), [rawHtml]);
  const resolvedContentKey = contentKey || `blog-article:${rawHtml.length}`;

  return (
    <>
      <div
        className={joinClassNames('bdt-content', className)}
        dangerouslySetInnerHTML={contentMarkup}
      />
      <BlogMediaGalleryEnhancer contentKey={resolvedContentKey} />
    </>
  );
}
