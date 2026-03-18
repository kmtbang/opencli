import { cli, Strategy } from '../../registry.js';

export const readCommand = cli({
  site: 'codex',
  name: 'read',
  description: 'Read the contents of the current Codex conversation thread',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  columns: ['Thread_Content'],
  func: async (page) => {
    const historyText = await page.evaluate(`
      (function() {
        // Fallback robust scraping heuristic for chat history panes
        // We look for large scrolling areas or generic message lists
        const threadContainer = document.querySelector('[role="log"], [data-testid="conversation"], main, .thread-container, .messages-list');
        
        if (threadContainer) {
          return threadContainer.innerText || threadContainer.textContent;
        }
        
        // If specific containers fail, just dump the whole body's readable text minus the navigation
        return document.body.innerText;
      })()
    `);

    return [
      {
        Thread_Content: historyText,
      },
    ];
  },
});
