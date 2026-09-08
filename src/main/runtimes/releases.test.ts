import { describe, expect, it } from 'vitest'
import { parseAtomTags } from './releases.js'

/** A trimmed slice of the real feed, in the order GitHub sends it. */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/ggml-org/llama.cpp/releases/tag/b10867"/>
  </entry>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/ggml-org/llama.cpp/releases/tag/b10865"/>
  </entry>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/ggml-org/llama.cpp/releases/tag/v0.4.0"/>
  </entry>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/ggml-org/llama.cpp/releases/tag/b10864"/>
  </entry>
</feed>`

describe('parseAtomTags', () => {
  it('reads build tags newest first', () => {
    expect(parseAtomTags(FEED)).toEqual(['b10867', 'b10865', 'b10864'])
  })

  it('skips the semver tag, which ships no binaries', () => {
    // `/releases/latest` redirects to exactly this tag, which is why it is
    // not the way to find a build: it has source archives and nothing else.
    expect(parseAtomTags(FEED)).not.toContain('v0.4.0')
  })

  it('does not repeat a tag the feed mentions twice', () => {
    expect(parseAtomTags(FEED + FEED)).toEqual(['b10867', 'b10865', 'b10864'])
  })

  it('returns nothing rather than guessing from an empty feed', () => {
    expect(parseAtomTags('<feed></feed>')).toEqual([])
  })
})
