import { cli, Strategy } from '../../registry.js';

export const sendCommand = cli({
  site: 'codex',
  name: 'send',
  description: 'Send text/commands to the Codex AI composer',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'text', required: true, help: 'Text, command (e.g. /review), or skill (e.g. $imagegen)' }],
  columns: ['Status', 'InjectedText'],
  func: async (page, kwargs) => {
    const textToInsert = kwargs.text as string;

    // We use evaluate to inject text bypassing complex nested shadow roots or contenteditables
    await page.evaluate(`
      (function(text) {
        // Attempt 1: Look for standard textarea/composer input
        let composer = document.querySelector('textarea, [contenteditable="true"]');
        
        // Basic heuristic: prioritize elements that are deeply nested, visible, and have 'composer' or 'input' classes
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        if (editables.length > 0) {
           composer = editables[editables.length - 1]; // Often the active input is appended near the end
        }

        if (!composer) {
          throw new Error('Could not find Composer input element in Codex UI');
        }

        composer.focus();
        
        // This handles Lexical/ProseMirror/Monaco rich-text editors effectively by mimicking human paste/type deeply.
        document.execCommand('insertText', false, text);
      })(${JSON.stringify(textToInsert)})
    `);

    // Simulate Enter key to submit
    await page.pressKey('Enter');

    return [
      {
        Status: 'Success',
        InjectedText: textToInsert,
      },
    ];
  },
});
