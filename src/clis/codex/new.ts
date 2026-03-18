import { cli, Strategy } from '../../registry.js';

export const newCommand = cli({
  site: 'codex',
  name: 'new',
  description: 'Start a new Codex conversation thread / isolated workspace',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  columns: ['Status', 'Action'],
  func: async (page) => {
    // According to research, Cmd+N / Ctrl+N spins up a new thread
    const isMac = process.platform === 'darwin';
    const newThreadKey = isMac ? 'Meta+N' : 'Control+N';
    
    // Simulate keyboard shortcut
    await page.pressKey(newThreadKey);

    // Wait a brief moment for UI animation
    await page.wait(1);

    return [
      {
        Status: 'Success',
        Action: `Pressed ${newThreadKey} to trigger New Thread`,
      },
    ];
  },
});
