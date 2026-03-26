'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const PLACEHOLDER_VALUE = '__placeholder__';
const ALL_POSTS_VALUE = '__all__';
const UI_TEXT = {
  label: 'Danh m\u1ee5c b\u00e0i vi\u1ebft',
  placeholder: 'Ch\u1ecdn danh m\u1ee5c b\u00e0i vi\u1ebft',
  allPosts: 'T\u1ea5t c\u1ea3 b\u00e0i vi\u1ebft',
};

export default function BlogCategorySelect({
  categories = [],
  currentCategorySlug = '',
  placeholder = UI_TEXT.placeholder,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedValue, setSelectedValue] = useState(
    currentCategorySlug || PLACEHOLDER_VALUE
  );

  useEffect(() => {
    setSelectedValue(currentCategorySlug || PLACEHOLDER_VALUE);
  }, [currentCategorySlug]);

  if (!Array.isArray(categories) || categories.length === 0) {
    return null;
  }

  const handleChange = (event) => {
    const nextValue = event.target.value;
    setSelectedValue(nextValue);

    if (nextValue === PLACEHOLDER_VALUE) {
      return;
    }

    startTransition(() => {
      if (nextValue === ALL_POSTS_VALUE) {
        router.push('/blog');
        return;
      }

      router.push(`/blog?category=${encodeURIComponent(nextValue)}`);
    });
  };

  return (
    <div className="bdt-category-select-shell">
      <label className="bdt-category-select-label" htmlFor="blog-category-select">
        {UI_TEXT.label}
      </label>

      <div className={`bdt-category-select-wrap${isPending ? ' is-pending' : ''}`}>
        <span className="material-symbols-outlined bdt-category-select-icon">category</span>
        <select
          id="blog-category-select"
          className="bdt-category-select"
          value={selectedValue}
          onChange={handleChange}
          disabled={isPending}
          aria-label={UI_TEXT.placeholder}
        >
          <option value={PLACEHOLDER_VALUE} disabled hidden>
            {placeholder}
          </option>
          <option value={ALL_POSTS_VALUE}>{UI_TEXT.allPosts}</option>
          {categories.map((category) => (
            <option key={category.id || category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <span className="material-symbols-outlined bdt-category-select-chevron">expand_more</span>
      </div>
    </div>
  );
}
