import { extractFileTags } from '../src/indexer/tagExtractor';
import { extractCommentLinks } from '../src/indexer/commentLinks';

const testContent = `/**
 * @file Test
 * @domain test
 * @see [[Architecture]]
 * @tested-by [[engine.test.ts]]
 * @adr [[ADR-001]]
 * @depends-on [[DatabaseSchema]]
 */
// TODO: fix this
// FIXME: broken
class Foo extends Bar {}`;

console.log('=== TAG EXTRACTION ===');
const tags = extractFileTags(testContent);
console.log(JSON.stringify(tags, null, 2));

console.log('\n=== COMMENT LINK EXTRACTION ===');
const links = extractCommentLinks(testContent, [
  '\\[\\[([^\\]]+)\\]\\]',
  '@see\\s+\\[\\[([^\\]]+)\\]\\]',
  '@link\\s+([^\\s,;]+)',
]);
console.log(JSON.stringify(links, null, 2));

// Now test the RESOLUTION — do the targets resolve to actual files?
console.log('\n=== ROOT CAUSE ANALYSIS ===');
console.log('Tagged links found:', tags.taggedLinks.length);
for (const tl of tags.taggedLinks) {
  console.log(`  ${tl.edgeType}: "${tl.target}" (line ${tl.line})`);
}
console.log('\nComment links found:', links.length);
for (const cl of links) {
  console.log(`  comment-link: "${cl.target}" (line ${cl.line})`);
}
