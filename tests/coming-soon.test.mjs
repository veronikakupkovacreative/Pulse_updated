import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../source/index.html',import.meta.url),'utf8');
const toolkit=await readFile(new URL('../source/tools.mjs',import.meta.url),'utf8');
const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');
test('YouTube is not linked to a fake download UI',()=>{
 assert.doesNotMatch(source,/id="yt-url"|id="yt-download"|id="youtube-source"/);
 assert.doesNotMatch(toolkit,/initYoutubeTool|selectTab\('youtube'\)/);
 assert.doesNotMatch(build,/noExports\(youtube\)|read\('youtube\.mjs'\)/);
});
test('redesign HTML uses reference layout and real audio entry point',()=>{
 assert.match(source,/data-view="editor"/);
 assert.match(source,/data-view="ai"/);
 assert.match(source,/id="audio-file-input"/);
 assert.doesNotMatch(source,/Clickable prototype · nothing is processed/);
});
