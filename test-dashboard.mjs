import { JSDOM } from 'jsdom';
import fs from 'fs/promises';

const html = await fs.readFile('public/index.html', 'utf-8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost:3000/',
  resources: 'usable',
});

const window = dom.window;
window.console.error = (...args) => console.log('CONSOLE ERROR:', ...args);
window.console.warn = (...args) => console.log('CONSOLE WARN:', ...args);

// Wait for scripts to execute
await new Promise(r => setTimeout(r, 3000));

console.log('Loading hidden after 3s:', window.document.getElementById('loading').classList.contains('hidden'));
console.log('timeValue text:', window.document.getElementById('timeValue')?.textContent);
console.log('Chart defined:', typeof window.Chart);
