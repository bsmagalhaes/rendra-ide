// Imagens de vitrine (site e README) são WebP com width/height; só a og-image fica PNG.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('docs/images só tem WebP e todas as referências existem', () => {
  assert.deepStrictEqual(fs.readdirSync(path.join(DOCS, 'images')).filter(f => !f.endsWith('.webp')), []);
  const refs = [...html.matchAll(/images\/([a-z0-9-]+)\.webp/g), ...readme.matchAll(/docs\/images\/([a-z0-9-]+)\.webp/g)];
  assert.ok(refs.length >= 9);
  for (const m of refs) assert.ok(fs.existsSync(path.join(DOCS, 'images', `${m[1]}.webp`)), m[0]);
  assert.ok(!/images\/[^"')`]*\.png/.test(html + readme), 'sobrou referência a PNG em images/');
});

test('imagens do HTML têm width e height; só a primeira dobra não é lazy', () => {
  const imgs = [...html.matchAll(/<img [^>]*src="images\/[^>]*>/g)].map(m => m[0]);
  assert.ok(imgs.length >= 3);
  for (const t of imgs) {
    assert.match(t, /width="\d+"/, t);
    assert.match(t, /height="\d+"/, t);
    if (!t.includes('hero-shot')) assert.match(t, /loading="lazy"/, t);
  }
});

test('og-image continua PNG (os robôs sociais não leem WebP de forma confiável)', () => {
  assert.match(html, /og-image\.png/);
  assert.ok(fs.existsSync(path.join(DOCS, 'og-image.png')));
});
