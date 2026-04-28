// Direct ACP test: SDK ↔ opencode
// Usage: npx tsx test_acp.ts [workspace_dir]

import { spawn } from 'child_process';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, type Client, type Agent } from '@agentclientprotocol/sdk';
import { resolveCommand } from './src/protocol/acp/connection.js';
import fs from 'fs-extra';
import path from 'path';

const CWD = (process.argv[2] || process.cwd()).replace(/\\/g, '/');
const COMMAND = 'opencode';
const ARGS = ['acp'];

console.log('=== ACP Test ===');
console.log(`Command: ${COMMAND} ${ARGS.join(' ')}`);
console.log(`CWD: ${CWD}`);

const { cmd, resolvedArgs } = resolveCommand(COMMAND, ARGS);
console.log(`Resolved: ${cmd} ${resolvedArgs.join(' ')}`);

const child = spawn(cmd, resolvedArgs, {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: CWD,
  windowsHide: true,
});

let stderrLog = '';
child.stderr?.on('data', (chunk) => {
  stderrLog += chunk.toString();
  process.stderr.write(`[STDERR] ${chunk.toString().trim().slice(0, 200)}\n`);
});

child.on('exit', (code) => console.log(`[PROCESS] exited with code ${code}`));
child.on('error', (err) => console.error(`[PROCESS] error: ${err.message}`));

const readable = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
const writable = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
const stream = ndJsonStream(writable, readable);

let updateCount = 0;
let toolCallCount = 0;
let textChunks: string[] = [];

const clientFactory = (_agent: Agent): Client => ({
  requestPermission: async (params) => {
    console.log(`[PERMISSION] tool=${params.toolCall.toolCallId} options=${params.options.map(o => o.optionId).join(',')}`);
    return { outcome: { outcome: 'selected' as const, optionId: params.options[0]?.optionId || 'allow-once' } };
  },

  sessionUpdate: async (params) => {
    updateCount++;
    const u = params.update;
    console.log(`[UPDATE #${updateCount}] type=${u.sessionUpdate} keys=${Object.keys(u).join(',')}`);
    if (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk' || u.sessionUpdate === 'user_message_chunk') {
      const block = (u as { content: { type: string; text?: string } }).content;
      const text = block?.type === 'text' ? block.text || '' : '';
      console.log(`  content.type=${block?.type} text="${text.slice(0, 100)}"`);
      if (text) textChunks.push(text);
    } else if (u.sessionUpdate === 'tool_call') {
      toolCallCount++;
      const tc = u as { title?: string; status: string };
      console.log(`  title=${tc.title} status=${tc.status}`);
    }
  },

  readTextFile: async (params) => {
    const p = path.resolve(CWD, params.path);
    const content = await fs.readFile(p, 'utf-8');
    return { content };
  },

  writeTextFile: async (params) => {
    const p = path.resolve(CWD, params.path);
    await fs.ensureDir(path.dirname(p));
    await fs.writeFile(p, params.content, 'utf-8');
    return {};
  },
});

const connection = new ClientSideConnection(clientFactory, stream);

async function runTest() {
  console.log('\n--- Initialize ---');
  const initResult = await connection.initialize({
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
    },
    clientInfo: { name: 'acp-test', title: 'ACP Test', version: '0.1.0' },
  });
  console.log(`Agent: ${initResult.agentInfo?.name} v${initResult.agentInfo?.version}`);
  console.log(`Protocol: ${initResult.protocolVersion}`);
  console.log(`Capabilities: session=${JSON.stringify(initResult.agentCapabilities?.sessionCapabilities)}, prompt=${JSON.stringify(initResult.agentCapabilities?.promptCapabilities)}`);

  console.log('\n--- New Session ---');
  const sessionResult = await connection.newSession({ cwd: CWD, mcpServers: [] });
  const sessionId = sessionResult.sessionId;
  console.log(`Session ID: ${sessionId}`);

  console.log('\n--- Prompt ---');
  const promptResult = await connection.prompt({
    sessionId,
    prompt: [{ type: 'text', text: 'Say hello in 3 words.' }],
  });
  console.log(`Stop reason: ${promptResult.stopReason}`);
  console.log(`Updates received: ${updateCount}`);
  console.log(`Tool calls: ${toolCallCount}`);
  console.log(`Text chunks: ${textChunks.length}`);
  if (textChunks.length > 0) {
    console.log(`Full response: ${textChunks.join('')}`);
  }

  if (stderrLog.includes('error') || stderrLog.includes('Error')) {
    console.log('\n--- STDERR (filtered) ---');
    console.log(stderrLog.slice(0, 1000));
  }

  console.log('\n--- Cleanup ---');
  child.kill();
  console.log('Done.');
}

runTest().catch((err) => {
  console.error('TEST FAILED:', err);
  console.log('--- STDERR ---');
  console.log(stderrLog.slice(0, 1000));
  child.kill();
  process.exit(1);
});
