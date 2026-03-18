import { cli, Strategy } from '../../registry.js';
import * as fs from 'fs';

export const dumpCommand = cli({
  site: 'codex',
  name: 'dump',
  description: 'Dump the DOM and Accessibility tree of Codex for reverse-engineering',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  columns: ['action', 'files'],
  func: async (page) => {
    // Extract full HTML
    const dom = await page.evaluate('document.body.innerHTML');
    fs.writeFileSync('/tmp/codex-dom.html', dom);

    // Get accessibility snapshot
    const snap = await page.snapshot({ interactive: false });
    fs.writeFileSync('/tmp/codex-snapshot.json', JSON.stringify(snap, null, 2));

    return [
      {
        action: 'Dom extraction finished',
        files: '/tmp/codex-dom.html, /tmp/codex-snapshot.json',
      },
    ];
  },
});
