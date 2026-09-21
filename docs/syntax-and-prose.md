# Syntax coloring and prose checks

[← Back to the README](../README.md)

**Syntax** gives nouns, verbs, adjectives, adverbs and conjunctions each their own color, the way a code editor shows you structure. It can mute everything else so one class carries the sentence. Too many adverbs reads as a rash.

**Prose checks** mark eight things worth a second look: filler words, passive voice, doubled words, easily confused pairs, vague pronouns, dialogue tags, sentence rhythm, and repeated uncommon words. Each check has its own switch and its own color. Marks are an underline by default, or a highlight, or colored text.

Both run on your machine. Both are guesswork. A mark is a nudge, not a verdict. Both are English only, and in another language they mark nothing rather than marking it wrongly.

## How the tagger works

A hand-written part-of-speech tagger. No API, no model, no bundled NLP library. Three passes over each visible line.

**Lexicon.** About a thousand words that suffix rules can't be trusted with: determiners, pronouns, prepositions, auxiliaries, irregular verbs, and common words that would otherwise be mis-tagged.

**Suffix rules.** Anything else is guessed from its ending. `-ly` is an adverb (minus the exceptions: family, reply, early). `-ing` and `-ed` are verbs. `-tion`, `-ment`, `-ness` are nouns. `-ous`, `-ful`, `-less` are adjectives. And so on.

**Context.** The pass that fixes what the first two got wrong, using the words either side. After a determiner, a verb becomes a noun (*the work*). An unknown word between a determiner and a noun is an adjective (*her difficult book*). After *to*, it's an infinitive.

Results are drawn as editor decorations, so they never flicker while you type. Only the lines on screen are tagged, and code, frontmatter and maths are skipped.

## What it gets wrong

Roughly nine words in ten on ordinary prose, in my own testing, not benchmarked against a tagged corpus. Weakest on dialogue-heavy fiction, fragments, and unusual proper nouns. That's why it's a writing aid and not a grammar checker.
