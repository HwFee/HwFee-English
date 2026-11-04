import unittest
from sentence_chunks import split_source, MAX_WORDS, MAX_CHARS
from youtube import group_sentences


class SentenceChunksTest(unittest.TestCase):
    def test_long_sentence_keeps_every_token_in_order(self):
        source = ' '.join(['Listen carefully to the complete phrase,'] * 9) + ' and then answer the question.'
        chunks = split_source({'s': source})
        self.assertGreater(len(chunks), 1)
        self.assertEqual(source, ' '.join(text for text, _, _ in chunks))
        for text, start, stop in chunks:
            self.assertLessEqual(stop - start, MAX_WORDS)
            self.assertLessEqual(len(text), MAX_CHARS)

    def test_a_protected_expression_stays_in_one_chunk(self):
        expression = 'take it with a grain of salt'
        source = ' '.join(['We should listen carefully'] * 5) + ' and ' + expression + ' before making a final decision.'
        chunks = split_source({'s': source}, [{'expr': expression}])
        self.assertEqual(1, sum(expression in text for text, _, _ in chunks))

    def test_standalone_caption_punctuation_does_not_shift_word_times(self):
        words = [{'word': text, 'start': i, 'end': i + .8} for i, text in enumerate(['Hello', ',', 'world', '.'])]
        sentences = group_sentences(words)
        self.assertEqual('Hello, world.', sentences[0]['text'])
        self.assertEqual(0, sentences[0]['start'])
        self.assertEqual(3.8, sentences[0]['end'])

    def test_new_caption_chunks_obey_both_phone_limits(self):
        words = [{'word': text, 'start': i / 2, 'end': (i + 1) / 2}
                 for i, text in enumerate(('This is another complete example with words ' * 15).split())]
        sentences = group_sentences(words)
        self.assertEqual(' '.join(word['word'] for word in words), ' '.join(sentence['text'] for sentence in sentences))
        self.assertTrue(all(len(sentence['text'].split()) <= MAX_WORDS and len(sentence['text']) <= MAX_CHARS for sentence in sentences))


if __name__ == '__main__':
    unittest.main()
