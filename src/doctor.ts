import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { IPage } from './types.js';
import { PlaywrightMCP, getTokenFingerprint } from './browser.js';
import { browserSession } from './runtime.js';

const PLAYWRIGHT_SERVER_NAME = 'playwright';
const PLAYWRIGHT_TOKEN_ENV = 'PLAYWRIGHT_MCP_EXTENSION_TOKEN';
const PLAYWRIGHT_EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';
const TOKEN_LINE_RE = /^(\s*export\s+PLAYWRIGHT_MCP_EXTENSION_TOKEN=)(['"]?)([^'"\\\n]+)\2\s*$/m;
export type DoctorOptions = {
  fix?: boolean;
  yes?: boolean;
  shellRc?: string;
  configPaths?: string[];
  token?: string;
  cliVersion?: string;
};

export type ShellFileStatus = {
  path: string;
  exists: boolean;
  token: string | null;
  fingerprint: string | null;
};

export type McpConfigFormat = 'json' | 'toml';

export type McpConfigStatus = {
  path: string;
  exists: boolean;
  format: McpConfigFormat;
  token: string | null;
  fingerprint: string | null;
  writable: boolean;
  parseError?: string;
};

export type DoctorReport = {
  cliVersion?: string;
  envToken: string | null;
  envFingerprint: string | null;
  extensionToken: string | null;
  extensionFingerprint: string | null;
  shellFiles: ShellFileStatus[];
  configs: McpConfigStatus[];
  recommendedToken: string | null;
  recommendedFingerprint: string | null;
  warnings: string[];
  issues: string[];
};

type ReportStatus = 'OK' | 'MISSING' | 'MISMATCH' | 'WARN';

function label(status: ReportStatus): string {
  return `[${status}]`;
}

function statusLine(status: ReportStatus, text: string): string {
  return `${label(status)} ${text}`;
}

function tokenSummary(token: string | null, fingerprint: string | null): string {
  if (!token) return 'missing';
  return `configured (${fingerprint})`;
}

export function getDefaultShellRcPath(): string {
  const shell = process.env.SHELL ?? '';
  if (shell.endsWith('/bash')) return path.join(os.homedir(), '.bashrc');
  if (shell.endsWith('/fish')) return path.join(os.homedir(), '.config', 'fish', 'config.fish');
  return path.join(os.homedir(), '.zshrc');
}

export function getDefaultMcpConfigPaths(cwd: string = process.cwd()): string[] {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.codex', 'config.toml'),
    path.join(home, '.codex', 'mcp.json'),
    path.join(home, '.cursor', 'mcp.json'),
    path.join(home, '.config', 'opencode', 'opencode.json'),
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    path.join(cwd, '.cursor', 'mcp.json'),
    path.join(cwd, '.vscode', 'mcp.json'),
    path.join(cwd, '.opencode', 'opencode.json'),
  ];
  return [...new Set(candidates)];
}

export function readTokenFromShellContent(content: string): string | null {
  const m = content.match(TOKEN_LINE_RE);
  return m?.[3] ?? null;
}

export function upsertShellToken(content: string, token: string): string {
  const nextLine = `export ${PLAYWRIGHT_TOKEN_ENV}="${token}"`;
  if (!content.trim()) return `${nextLine}\n`;
  if (TOKEN_LINE_RE.test(content)) return content.replace(TOKEN_LINE_RE, `$1"${
    token
  }"`);
  return `${content.replace(/\s*$/, '')}\n${nextLine}\n`;
}

function readJsonConfigToken(content: string): string | null {
  try {
    const parsed = JSON.parse(content);
    return readTokenFromJsonObject(parsed);
  } catch {
    return null;
  }
}

function readTokenFromJsonObject(parsed: any): string | null {
  const direct = parsed?.mcpServers?.[PLAYWRIGHT_SERVER_NAME]?.env?.[PLAYWRIGHT_TOKEN_ENV];
  if (typeof direct === 'string' && direct) return direct;
  const opencode = parsed?.mcp?.[PLAYWRIGHT_SERVER_NAME]?.env?.[PLAYWRIGHT_TOKEN_ENV];
  if (typeof opencode === 'string' && opencode) return opencode;
  return null;
}

export function upsertJsonConfigToken(content: string, token: string): string {
  const parsed = content.trim() ? JSON.parse(content) : {};
  if (parsed?.mcpServers) {
    parsed.mcpServers[PLAYWRIGHT_SERVER_NAME] = parsed.mcpServers[PLAYWRIGHT_SERVER_NAME] ?? {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--extension'],
    };
    parsed.mcpServers[PLAYWRIGHT_SERVER_NAME].env = parsed.mcpServers[PLAYWRIGHT_SERVER_NAME].env ?? {};
    parsed.mcpServers[PLAYWRIGHT_SERVER_NAME].env[PLAYWRIGHT_TOKEN_ENV] = token;
  } else {
    parsed.mcp = parsed.mcp ?? {};
    parsed.mcp[PLAYWRIGHT_SERVER_NAME] = parsed.mcp[PLAYWRIGHT_SERVER_NAME] ?? {
      command: ['npx', '-y', '@playwright/mcp@latest', '--extension'],
      enabled: true,
      type: 'local',
    };
    parsed.mcp[PLAYWRIGHT_SERVER_NAME].env = parsed.mcp[PLAYWRIGHT_SERVER_NAME].env ?? {};
    parsed.mcp[PLAYWRIGHT_SERVER_NAME].env[PLAYWRIGHT_TOKEN_ENV] = token;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function readTomlConfigToken(content: string): string | null {
  const sectionMatch = content.match(/\[mcp_servers\.playwright\.env\][\s\S]*?(?=\n\[|$)/);
  if (!sectionMatch) return null;
  const tokenMatch = sectionMatch[0].match(/^\s*PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*"([^"\n]+)"/m);
  return tokenMatch?.[1] ?? null;
}

export function upsertTomlConfigToken(content: string, token: string): string {
  const envSectionRe = /(\[mcp_servers\.playwright\.env\][\s\S]*?)(?=\n\[|$)/;
  const tokenLine = `PLAYWRIGHT_MCP_EXTENSION_TOKEN = "${token}"`;
  if (envSectionRe.test(content)) {
    return content.replace(envSectionRe, (section) => {
      if (/^\s*PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=/m.test(section)) {
        return section.replace(/^\s*PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=.*$/m, tokenLine);
      }
      return `${section.replace(/\s*$/, '')}\n${tokenLine}\n`;
    });
  }

  const baseSectionRe = /(\[mcp_servers\.playwright\][\s\S]*?)(?=\n\[|$)/;
  if (baseSectionRe.test(content)) {
    return content.replace(baseSectionRe, (section) => `${section.replace(/\s*$/, '')}\n\n[mcp_servers.playwright.env]\n${tokenLine}\n`);
  }

  const prefix = content.trim() ? `${content.replace(/\s*$/, '')}\n\n` : '';
  return `${prefix}[mcp_servers.playwright]\ntype = "stdio"\ncommand = "npx"\nargs = ["-y", "@playwright/mcp@latest", "--extension"]\n\n[mcp_servers.playwright.env]\n${tokenLine}\n`;
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function canWrite(filePath: string): boolean {
  try {
    if (fileExists(filePath)) {
      fs.accessSync(filePath, fs.constants.W_OK);
      return true;
    }
    fs.accessSync(path.dirname(filePath), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function readConfigStatus(filePath: string): McpConfigStatus {
  const format: McpConfigFormat = filePath.endsWith('.toml') ? 'toml' : 'json';
  if (!fileExists(filePath)) {
    return { path: filePath, exists: false, format, token: null, fingerprint: null, writable: canWrite(filePath) };
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const token = format === 'toml' ? readTomlConfigToken(content) : readJsonConfigToken(content);
    return {
      path: filePath,
      exists: true,
      format,
      token,
      fingerprint: getTokenFingerprint(token ?? undefined),
      writable: canWrite(filePath),
    };
  } catch (error: any) {
    return {
      path: filePath,
      exists: true,
      format,
      token: null,
      fingerprint: null,
      writable: canWrite(filePath),
      parseError: error?.message ?? String(error),
    };
  }
}

/**
 * Discover the auth token stored by the Playwright MCP Bridge extension
 * by scanning Chrome's LevelDB localStorage files directly.
 *
 * Uses `strings` + `grep` for fast binary scanning on macOS/Linux,
 * with a pure-Node fallback on Windows.
 */
export function discoverExtensionToken(): string | null {
  const home = os.homedir();
  const platform = os.platform();
  const bases: string[] = [];

  if (platform === 'darwin') {
    bases.push(
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary'),
      path.join(home, 'Library', 'Application Support', 'Chromium'),
      path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
    );
  } else if (platform === 'linux') {
    bases.push(
      path.join(home, '.config', 'google-chrome'),
      path.join(home, '.config', 'chromium'),
      path.join(home, '.config', 'microsoft-edge'),
    );
  } else if (platform === 'win32') {
    const appData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    bases.push(
      path.join(appData, 'Google', 'Chrome', 'User Data'),
      path.join(appData, 'Microsoft', 'Edge', 'User Data'),
    );
  }

  const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3'];
  // Token is 43 chars of base64url (from 32 random bytes)
  const tokenRe = /([A-Za-z0-9_-]{40,50})/;

  for (const base of bases) {
    for (const profile of profiles) {
      const dir = path.join(base, profile, 'Local Storage', 'leveldb');
      if (!fileExists(dir)) continue;

      // Fast path: use strings + grep to find candidate files and extract token
      if (platform !== 'win32') {
        const token = extractTokenViaStrings(dir, tokenRe);
        if (token) return token;
        continue;
      }

      // Slow path (Windows): read binary files directly
      const token = extractTokenViaBinaryRead(dir, tokenRe);
      if (token) return token;
    }
  }

  return null;
}

function extractTokenViaStrings(dir: string, tokenRe: RegExp): string | null {
  try {
    // Step 1: Find files containing the extension ID
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const grepResult = execSync(
      `grep -rl '${PLAYWRIGHT_EXTENSION_ID}' "${dir}" 2>/dev/null | head -10`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    if (!grepResult) return null;

    const candidateFiles = grepResult.split('\n').filter(Boolean);

    for (const file of candidateFiles) {
      // Step 2: Extract strings containing "auth-token" or the extension ID pattern
      try {
        const stringsOutput = execSync(
          `strings "${file}" 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
        );

        // Look for the token pattern near the extension ID + auth-token key
        // LevelDB stores: "EXTENSION_ID.N\0...\0auth-token\0R\n...TOKEN_VALUE"
        const lines = stringsOutput.split('\n');
        let foundExtKey = false;
        for (const line of lines) {
          if (line.includes(PLAYWRIGHT_EXTENSION_ID)) foundExtKey = true;
          if (foundExtKey && line.includes('auth-token')) {
            // The token should appear in a nearby line
            foundExtKey = false; // reset
            continue;
          }
          if (foundExtKey || line.includes('auth-token')) {
            const m = line.match(tokenRe);
            if (m && validateBase64urlToken(m[1])) return m[1];
          }
        }

        // Also try: look for token value after "EXTENSION_ID.N" pattern
        const extKeyMatch = stringsOutput.match(
          new RegExp(`${PLAYWRIGHT_EXTENSION_ID}\\.\\d[\\s\\S]{0,100}?${tokenRe.source}`),
        );
        if (extKeyMatch?.[1] && validateBase64urlToken(extKeyMatch[1])) return extKeyMatch[1];
      } catch { continue; }
    }
  } catch {}
  return null;
}

function extractTokenViaBinaryRead(dir: string, tokenRe: RegExp): string | null {
  const extIdBuf = Buffer.from(PLAYWRIGHT_EXTENSION_ID);
  const keyBuf = Buffer.from('auth-token');

  let files: string[];
  try {
    files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.ldb') || f.endsWith('.log'))
      .map(f => path.join(dir, f));
  } catch { return null; }

  // Sort by mtime descending
  files.sort((a, b) => {
    try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
  });

  for (const file of files) {
    let data: Buffer;
    try { data = fs.readFileSync(file); } catch { continue; }

    // Quick check: does file contain both the extension ID and auth-token key?
    const extPos = data.indexOf(extIdBuf);
    if (extPos === -1) continue;
    const keyPos = data.indexOf(keyBuf, Math.max(0, extPos - 500));
    if (keyPos === -1) continue;

    // Scan for token value after auth-token key
    let idx = 0;
    while (true) {
      const kp = data.indexOf(keyBuf, idx);
      if (kp === -1) break;

      const contextStart = Math.max(0, kp - 500);
      if (data.indexOf(extIdBuf, contextStart) !== -1 && data.indexOf(extIdBuf, contextStart) < kp) {
        const after = data.subarray(kp + keyBuf.length, kp + keyBuf.length + 200).toString('latin1');
        const m = after.match(tokenRe);
        if (m && validateBase64urlToken(m[1])) return m[1];
      }
      idx = kp + 1;
    }
  }
  return null;
}

function validateBase64urlToken(token: string): boolean {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(b64, 'base64');
    return decoded.length >= 28 && decoded.length <= 36;
  } catch { return false; }
}


export async function runBrowserDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const envToken = process.env[PLAYWRIGHT_TOKEN_ENV] ?? null;
  const shellPath = opts.shellRc ?? getDefaultShellRcPath();
  const shellFiles: ShellFileStatus[] = [shellPath].map((filePath) => {
    if (!fileExists(filePath)) return { path: filePath, exists: false, token: null, fingerprint: null };
    const content = fs.readFileSync(filePath, 'utf-8');
    const token = readTokenFromShellContent(content);
    return { path: filePath, exists: true, token, fingerprint: getTokenFingerprint(token ?? undefined) };
  });
  const configPaths = opts.configPaths?.length ? opts.configPaths : getDefaultMcpConfigPaths();
  const configs = configPaths.map(readConfigStatus);

  // Try to discover the token directly from the Chrome extension's localStorage
  const extensionToken = discoverExtensionToken();

  const allTokens = [
    opts.token ?? null,
    extensionToken,
    envToken,
    ...shellFiles.map(s => s.token),
    ...configs.map(c => c.token),
  ].filter((v): v is string => !!v);
  const uniqueTokens = [...new Set(allTokens)];
  const recommendedToken = opts.token ?? extensionToken ?? envToken ?? (uniqueTokens.length === 1 ? uniqueTokens[0] : null) ?? null;

  const report: DoctorReport = {
    cliVersion: opts.cliVersion,
    envToken,
    envFingerprint: getTokenFingerprint(envToken ?? undefined),
    extensionToken,
    extensionFingerprint: getTokenFingerprint(extensionToken ?? undefined),
    shellFiles,
    configs,
    recommendedToken,
    recommendedFingerprint: getTokenFingerprint(recommendedToken ?? undefined),
    warnings: [],
    issues: [],
  };

  if (!envToken) report.issues.push(`Current environment is missing ${PLAYWRIGHT_TOKEN_ENV}.`);
  if (!shellFiles.some(s => s.token)) report.issues.push('Shell startup file does not export PLAYWRIGHT_MCP_EXTENSION_TOKEN.');
  if (!configs.some(c => c.token)) report.issues.push('No scanned MCP config currently contains a Playwright extension token.');
  if (uniqueTokens.length > 1) report.issues.push('Detected inconsistent Playwright MCP tokens across env/config files.');
  for (const config of configs) {
    if (config.parseError) report.warnings.push(`Could not parse ${config.path}: ${config.parseError}`);
  }
  if (!recommendedToken) {
    report.warnings.push('No token source found.');
  }
  return report;
}

export function renderBrowserDoctorReport(report: DoctorReport): string {
  const tokenFingerprints = [
    report.extensionFingerprint,
    report.envFingerprint,
    ...report.shellFiles.map(shell => shell.fingerprint),
    ...report.configs.filter(config => config.exists).map(config => config.fingerprint),
  ].filter((value): value is string => !!value);
  const uniqueFingerprints = [...new Set(tokenFingerprints)];
  const hasMismatch = uniqueFingerprints.length > 1;
  const lines = [`opencli v${report.cliVersion ?? 'unknown'} doctor`, ''];

  const extStatus: ReportStatus = !report.extensionToken ? 'MISSING' : hasMismatch ? 'MISMATCH' : 'OK';
  lines.push(statusLine(extStatus, `Extension token (Chrome LevelDB): ${tokenSummary(report.extensionToken, report.extensionFingerprint)}`));

  const envStatus: ReportStatus = !report.envToken ? 'MISSING' : hasMismatch ? 'MISMATCH' : 'OK';
  lines.push(statusLine(envStatus, `Environment token: ${tokenSummary(report.envToken, report.envFingerprint)}`));

  for (const shell of report.shellFiles) {
    const shellStatus: ReportStatus = !shell.token ? 'MISSING' : hasMismatch ? 'MISMATCH' : 'OK';
    lines.push(statusLine(shellStatus, `Shell file ${shell.path}: ${tokenSummary(shell.token, shell.fingerprint)}`));
  }
  const existingConfigs = report.configs.filter(config => config.exists);
  const missingConfigCount = report.configs.length - existingConfigs.length;
  if (existingConfigs.length > 0) {
    for (const config of existingConfigs) {
      const parseSuffix = config.parseError ? ` (parse error: ${config.parseError})` : '';
      const configStatus: ReportStatus = config.parseError
        ? 'WARN'
        : !config.token
          ? 'MISSING'
          : hasMismatch
            ? 'MISMATCH'
            : 'OK';
      lines.push(statusLine(configStatus, `MCP config ${config.path}: ${tokenSummary(config.token, config.fingerprint)}${parseSuffix}`));
    }
  } else {
    lines.push(statusLine('MISSING', 'MCP config: no existing config files found in scanned locations'));
  }
  if (missingConfigCount > 0) lines.push(`     Other scanned config locations not present: ${missingConfigCount}`);
  lines.push('');
  lines.push(statusLine(
    hasMismatch ? 'MISMATCH' : report.recommendedToken ? 'OK' : 'WARN',
    `Recommended token fingerprint: ${report.recommendedFingerprint ?? 'unavailable'}`,
  ));
  if (report.issues.length) {
    lines.push('', 'Issues:');
    for (const issue of report.issues) lines.push(`- ${issue}`);
  }
  if (report.warnings.length) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  return lines.join('\n');
}

async function confirmPrompt(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function writeFileWithMkdir(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export async function applyBrowserDoctorFix(report: DoctorReport, opts: DoctorOptions = {}): Promise<string[]> {
  const token = opts.token ?? report.recommendedToken;
  if (!token) throw new Error('No Playwright MCP token is available to write. Provide --token first.');

  const plannedWrites: string[] = [];
  const shellPath = opts.shellRc ?? report.shellFiles[0]?.path ?? getDefaultShellRcPath();
  plannedWrites.push(shellPath);
  for (const config of report.configs) {
    if (!config.writable) continue;
    plannedWrites.push(config.path);
  }

  if (!opts.yes) {
    const ok = await confirmPrompt(`Update ${plannedWrites.length} file(s) with Playwright MCP token fingerprint ${getTokenFingerprint(token)}?`);
    if (!ok) return [];
  }

  const written: string[] = [];
  const shellBefore = fileExists(shellPath) ? fs.readFileSync(shellPath, 'utf-8') : '';
  writeFileWithMkdir(shellPath, upsertShellToken(shellBefore, token));
  written.push(shellPath);

  for (const config of report.configs) {
    if (!config.writable || config.parseError) continue;
    const before = fileExists(config.path) ? fs.readFileSync(config.path, 'utf-8') : '';
    const next = config.format === 'toml' ? upsertTomlConfigToken(before, token) : upsertJsonConfigToken(before, token);
    writeFileWithMkdir(config.path, next);
    written.push(config.path);
  }

  process.env[PLAYWRIGHT_TOKEN_ENV] = token;
  return written;
}
