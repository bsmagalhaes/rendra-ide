#!/usr/bin/env node
// Maintainer tool: `npm run prices:update`
// Reads the official price pages (Anthropic for Claude Code, OpenAI for Codex), updates
// pricing.json and stamps the date. Commit and push pricing.json: every installed Rendra IDE
// checks that file on GitHub when it opens and offers the new prices to its users.
// Rows that are not on the pages (older models, "default") are kept as they are.

const fs = require('fs');
const path = require('path');
const { fetchPrices } = require('../src/pricing-sync');

const FILE = path.join(__dirname, '..', 'pricing.json');

(async () => {
  const pricing = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  let changed = 0;
  for (const which of ['claude', 'codex']) {
    try {
      const { url, entries } = await fetchPrices(which);
      const rows = new Map(pricing[which].map(r => [r.pattern, r]));
      for (const e of entries) {
        const before = JSON.stringify(rows.get(e.pattern) || null);
        rows.set(e.pattern, { ...rows.get(e.pattern), ...e });
        if (before !== JSON.stringify(rows.get(e.pattern))) changed++;
      }
      pricing[which] = [...rows.values()].sort((a, b) => (a.pattern === 'default') - (b.pattern === 'default'));
      pricing.updatedAt = { ...pricing.updatedAt, [which]: today };
      console.log(`✔ ${which}: ${entries.length} modelos lidos de ${url}`);
    } catch (e) {
      console.log(`✖ ${which}: ${e.message} (mantidos os valores atuais; edite pricing.json à mão se precisar)`);
      process.exitCode = 1;
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(pricing, null, 2) + '\n');
  console.log(`\n${changed} preço(s) alterado(s). Publique com:\n  git add pricing.json && git commit -m "prices: ${today}" && git push`);
})();
