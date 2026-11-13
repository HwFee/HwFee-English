# Shanbay API map — reverse-engineered

Sources: `扇贝翻译` extension v0.17.1 (`{09767ac2-b538-a31e-5ddd-2ad053169458}.xpi`, read out of the Zen profile) and `扇贝阅读助手/lib.mjs`.

## Auth

The browser extension relies on the browser cookie jar (`credentials: 'include'`). The Android app sends the cookie explicitly instead — verified working:

```
Cookie: auth_token=<…>; csrftoken=<…>
X-CSRFToken: <csrftoken value>
Origin: https://web.shanbay.com
Referer: https://web.shanbay.com/
User-Agent: Mozilla/5.0
```

Verified 200 on `GET /bayuser/user` and `GET /wordsapp/user_material_books/current`.

Login page to drive the WebView: `https://web.shanbay.com/bayaccount/login?channel=translate`

## Words / learning book

| Method | Path | Purpose |
|---|---|---|
| GET | `/bayuser/user` | account; 401 = session dead |
| GET | `/wordsapp/user_material_books/current` | current learning book |
| GET | `/wordsapp/user_material_books/{id}/learning/statuses` | today's counts |
| GET | `/wordsapp/user_material_books/{id}/learning/items/sync` | completed item ids |
| GET | `/wordsapp/user_material_books/{id}/learning/words/today_learning_items?type_of=NEW\|REVIEW&page=&ipp=50` | today's words, paged |
| GET | `/wordsapp/user_material_books/{id}/learning/words/simple_learned_items?page=1&ipp=1` | current book's mastered (marked 太简单) total |

The `today_learning_items` response carries a `data` string that must be decoded — that is what `vendor/decode.mjs` in 扇贝阅读助手 does. Port it as-is.

The `simple_learned_items` response uses the same decoder. Resolve `{id}` from
`materialbook_id` on `/wordsapp/user_material_books/current`; the translation feed's
`learning_book_id` is a different identifier. Use decoded `total` for 已掌握.
The book's `finish_count` describes words already studied, rather than words marked 太简单.

## Article

| Method | Path | Purpose |
|---|---|---|
| GET | `/abc/applets/cross_learning/article` | 词文串学 match — preferred source |
| GET | `/news/retrieve/articles?ipp=10&page=1` | latest article list |
| GET | `/news/articles/{id}?source=1` | article body |

Body comes as XML-ish markup: `<para><sent>` with possibly CDATA. Parse paragraphs by joining sentences, as `web/read/bridge.mjs` does.

## Wordbook (add / check / remove)

| Method | Path | Body |
|---|---|---|
| GET | `/wordscollection/words?page=1&ipp=1` | `{objects, total}`; official collection total for 生词本 |
| GET | `/wordscollection/words_check?vocab_ids=a&vocab_ids=b` | → `{objects:[{vocab_id, exists}]}` |
| POST | `/wordscollection/words` | `{vocab_id, business_id, unique_code?, source_page_url?, source_scene_title?}` |
| DELETE | `/wordscollection/words` | `{vocab_ids: [...]}` |
| POST | `/wordscollection/words/reset` | `{vocab_ids: [...]}` — schedule today's review |

429 = rate limited, 401 = session dead. Wordbook creation requires `business_id: 1` (verified; omitting it returns HTTP 400).

## Word highlight feed — verified on device

Categories: `today`, `wordbook`, `learned`, `unlearned`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/bay-translate/user/books/current` | `{learning_book_id, book_name}` |
| GET | `/bay-translate/user_vocabs?categories=…&page=&ipp=1000` | `{vocabs, covered_categories, degraded, date, page, ipp, total}` |
| GET | `/bay-translate/highlight/vocabs?page=&ipp=50` | `{vocabs, page, ipp, total}` |

The `/bay-translate` prefix was inferred from the extension and is confirmed live: a real account
returned `total: 2432` across all four categories, paged in three `ipp=1000` requests.

Vocab entry shape: `{vocab, variants, categories}`, e.g.
`{"vocab":"embryo","categories":8,"variants":["embryoes","embryos"]}`.

- `variants` carries the inflections — highlighting has to match these, not just `vocab`.
- `categories` is a bitmask in the order `today, wordbook, learned, unlearned` (so `8` = unlearned).
- `covered_categories` is the category-coverage bitmask, intersected across pages; `degraded` and
  `date` must not be discarded. Missing today/wordbook coverage is not a complete cache success.

Read-only inspection of the installed Zen extension **0.17.1** on 2026-11-11 confirmed its variant
merging, coverage/date metadata and periodic synchronization. The app keeps a six-hour offline
snapshot but revalidates on reader entry/resume (one-minute throttle), shows partial-sync failures,
and offers **刷新高亮**. The already-fetched NEW/REVIEW headwords supplement the feed without another
learning-list request; their flags apply to provider-supplied variants. Yesterday's daily flags do
not survive a date rollover. See [CHANGELOG.md](CHANGELOG.md) (`v1.0.12 — v5`).

This feed is a subset for highlighting. Its `wordbook` and `learned` totals must not
populate the home dashboard. Live checks on 2026-11-03 returned 364 collected words
versus 244 in the highlight feed, and 79 mastered words in the current book versus
563 in the feed. These are separate scopes, not interchangeable counts.

After a confirmed collection edit, invalidate freshness and start a background count
request immediately. Keep the last official numbers in memory and local storage;
failed or older requests never blank or overwrite them. Home re-entry rechecks after
60 seconds. Persisted counts use `countsVersion: 2` to reject old highlight totals.

## Word meaning — verified on device

| Method | Path |
|---|---|
| GET | `/abc/words/senses?vocabulary_content=<word>` |

Returns `{audios, content, definitions, id, id_int, ref_id, vocab_type, labels}`. The block this app
uses is `definitions.cn[]` → `{def, pos, dict_id, sense_id}`, e.g.
`{"def":"胚胎；初级阶段，萌芽时期；胚","pos":"n."}`. `audios[]` carries pronunciation.

`401` = session expired, `404` = the word is not in the dictionary (show the popup without a meaning
rather than failing).

## Sentence tools and account quota

Shanbay is the primary sentence provider; a configured personal API is the fallback.

- `GET https://apiv3.shanbay.com/bay-translate/quota` — cookie-authenticated account query,
  `{remaining_percent, reset_at}`. Verified 2026-11-04: HTTP 200, 100%, reset
  `2026-11-05T04:00:00+08:00`. Found in the official extension's `background.js` and
  `chunks/chrome-polyfill-j21f0XIq.js`. It works independently of sentence-request cooldowns.

- `POST https://sse.shanbay.com/bay-translate/sse/translate_sentence` — SSE, `{request_id, text}`
- `POST …/sse/sentence_analysis` — SSE, `{request_id, text}`
- `POST …/sse/translate_batch`, `…/sse/page_chat`

They are metered (`usage` event → `remaining_percent`, `quota_exceeded` → `reset_at`) and gated on
`translate_sentence` (`403` → `vip_required`). Failures use the personal API when configured.

Full wire format of the 长难句 pair — request bodies, every SSE event, the eight component types, and a real
captured stream — is in [shanbay-sentence-analysis.md](shanbay-sentence-analysis.md). Measured live:
one 55-word analysis cost 2 quota points (its translation 7); a whole-article `translate_sentence`
pass over 37 sentences (657 words) consumed 7 percentage points (`91% → 84%`, ~26 seconds).

Sentence bookmarks (`/bay-translate/bookmarks`, `/bookmarks/check?sentence=`, `PUT`/`DELETE /bookmarks/{id}`) remain available if saving translated sentences is ever wanted — they are a separate store from the wordbook.
