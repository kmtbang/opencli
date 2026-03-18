import { cli, Strategy } from '../../registry.js';

export const statusCommand = cli({
  site: 'codex',
  name: 'status',
  description: 'Check active CDP connection to OpenAI Codex App',
  domain: 'localhost',
  strategy: Strategy.UI, // Interactive UI manipulation
  browser: true,
  columns: ['Status', 'Url', 'Title'],
  func: async (page) => {
    const url = await page.evaluate('window.location.href');
    const title = await page.evaluate('document.title');

    return [
      {
        Status: 'Connected',
        Url: url,
        Title: title,
      },
    ];
  },
});
