// Keep an explicitly marked local article only for its date; a requested URL wins.
export function shouldPreserveArticle(article, date, requestedArticle) {
  return !requestedArticle && article?.date === date && article?.preserveOnDailyUpdate === true &&
    Array.isArray(article.paragraphs) && article.paragraphs.length > 0 &&
    article.paragraphs.every(paragraph => typeof paragraph === 'string' && paragraph.trim());
}
