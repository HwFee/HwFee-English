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

The `today_learning_items` response carries a `data` string that must be decoded — that is what `vendor/decode.mjs` in 扇贝阅读助手 does. Port it as-is.

## Article

| Method | Path | Purpose |
|---|---|---|
| GET | `/abc/applets/cross_learning/article` | 词文串学 match — preferred source |
| GET | `/news/retrieve/articles?ipp=10&page=1` | latest article list |
| GET | `/news/articles/{id}?source=1` | article body |

Body comes as XML-ish markup: `<para><sent>` with possibly CDATA. Parse paragraphs by joining sentences, as `tools/import-daily.mjs` does.

## Wordbook (add / check / remove)

| Method | Path | Body |
|---|---|---|
| GET | `/wordscollection/words_check?vocab_ids=a&vocab_ids=b` | → `{objects:[{vocab_id, exists}]}` |
| POST | `/wordscollection/words` | `{vocab_id, business_id, unique_code?, source_page_url?, source_scene_title?}` |
| DELETE | `/wordscollection/words` | `{vocab_ids: [...]}` |
| POST | `/wordscollection/words/reset` | `{vocab_ids: [...]}` — schedule today's review |

429 = rate limited, 401 = session dead. `business_id` is supplied by the extension at call time; confirm its constant on first live call.

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

## Word meaning — verified on device

| Method | Path |
|---|---|
| GET | `/abc/words/senses?vocabulary_content=<word>` |

Returns `{audios, content, definitions, id, id_int, ref_id, vocab_type, labels}`. The block this app
uses is `definitions.cn[]` → `{def, pos, dict_id, sense_id}`, e.g.
`{"def":"胚胎；初级阶段，萌芽时期；胚","pos":"n."}`. `audios[]` carries pronunciation.

`401` = session expired, `404` = the word is not in the dictionary (show the popup without a meaning
rather than failing).

## Not used

Decided against, recorded so nobody re-adds it: the extension's server-side translation.

- `POST https://sse.shanbay.com/bay-translate/sse/translate_sentence` — SSE, `{request_id, text}`
- `POST …/sse/sentence_analysis` — SSE, `{request_id, text}`
- `POST …/sse/translate_batch`, `…/sse/page_chat`

They are metered (`usage` event → `remaining_percent`, `quota_exceeded` → `reset_at`) and gated (`403` → `vip_required`). Translation runs on the user's own LLM key instead.

Sentence bookmarks (`/bay-translate/bookmarks`, `/bookmarks/check?sentence=`, `PUT`/`DELETE /bookmarks/{id}`) remain available if saving translated sentences is ever wanted — they are a separate store from the wordbook.
