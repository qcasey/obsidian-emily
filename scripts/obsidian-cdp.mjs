#!/usr/bin/env node
// Drive a running Obsidian over the Chrome DevTools Protocol, for visual checks during development.
//
// Obsidian must be started with remote debugging on (localhost only):
//   node scripts/obsidian-cdp.mjs launch          quit Obsidian and reopen it with the debug port
//
// Then:
//   node scripts/obsidian-cdp.mjs shot out.png [--selector <css>] [--viewport 420x900]
//                                    [--scroll-to <css>] [--eval '<js>']
//                                                                   screenshot the window or one element,
//                                                                   optionally at an emulated window size;
//                                                                   --eval measures at that size too
//   node scripts/obsidian-cdp.mjs eval '<js>'                       evaluate in the app, print the JSON result
//   node scripts/obsidian-cdp.mjs command emily:open-tracking-chart run an Obsidian command by id
//   node scripts/obsidian-cdp.mjs reload emily                       reload a plugin after a build, and wait for it
//
// Needs Node 22+ (built-in WebSocket). macOS only for `launch`.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.OBSIDIAN_CDP_PORT ?? 9222);
const BASE = `http://127.0.0.1:${PORT}`;

async function pages() {
	const res = await fetch(`${BASE}/json/list`);
	return (await res.json()).filter((t) => t.type === 'page' && t.url.startsWith('app://obsidian.md'));
}

async function connect() {
	let list;
	try {
		list = await pages();
	} catch {
		throw new Error(`Nothing is listening on ${BASE}. Run: node scripts/obsidian-cdp.mjs launch`);
	}
	if (!list.length) throw new Error('Obsidian is running but has no open vault window.');
	const ws = new WebSocket(list[0].webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true });
		ws.addEventListener('error', () => reject(new Error('Could not open the DevTools socket.')), { once: true });
	});
	let nextId = 0;
	const pending = new Map();
	ws.addEventListener('message', (ev) => {
		const msg = JSON.parse(ev.data);
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		if (msg.error) p.reject(new Error(msg.error.message));
		else p.resolve(msg.result);
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify({ id, method, params }));
		});
	return { send, close: () => ws.close() };
}

async function evaluate(cdp, expression) {
	const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (exceptionDetails) {
		throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
	}
	return result.value;
}

async function launch() {
	try {
		execFileSync('osascript', ['-e', 'tell application "Obsidian" to quit']);
	} catch {
		// not running
	}
	for (let i = 0; i < 40; i++) {
		try {
			execFileSync('pgrep', ['-x', 'Obsidian']);
			await sleep(250);
		} catch {
			break;
		}
	}
	execFileSync('open', ['-a', 'Obsidian', '--args', `--remote-debugging-port=${PORT}`]);
	for (let i = 0; i < 60; i++) {
		try {
			if ((await pages()).length) return console.log(`Obsidian is up with DevTools on ${BASE}`);
		} catch {
			// not listening yet
		}
		await sleep(250);
	}
	throw new Error('Obsidian did not expose the debug port in time.');
}

async function shot(args) {
	const opt = (name) => {
		const i = args.indexOf(name);
		return i >= 0 ? args.splice(i, 2)[1] : null;
	};
	const selector = opt('--selector');
	const viewport = opt('--viewport');
	const scrollTo = opt('--scroll-to');
	const probe = opt('--eval');
	const out = args[0] ?? 'obsidian.png';
	const cdp = await connect();
	try {
		const params = { format: 'png' };
		if (viewport) {
			// The override lasts only as long as this DevTools session, so the window snaps back afterwards.
			const [width, height] = viewport.split('x').map(Number);
			if (!width || !height) throw new Error('Use --viewport <width>x<height>, e.g. 420x900');
			await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
			await sleep(400); // let resize observers and layout settle
		}
		if (scrollTo) {
			const found = await evaluate(
				cdp,
				`(() => { const el = document.querySelector(${JSON.stringify(scrollTo)}); el?.scrollIntoView({ block: 'center' }); return !!el; })()`,
			);
			if (!found) throw new Error(`No element matches ${scrollTo}`);
			await sleep(200);
		}
		// Runs in the same session as the screenshot, so it sees the emulated window size.
		if (probe) console.log(JSON.stringify(await evaluate(cdp, probe), null, 2));
		if (selector) {
			const rect = await evaluate(
				cdp,
				`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
				el.scrollIntoView({ block: 'center' }); // centre, so sticky headers do not cover it
				const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
			);
			if (!rect) throw new Error(`No element matches ${selector}`);
			if (!rect.width || !rect.height) throw new Error(`${selector} has no size (hidden?)`);
			params.clip = { ...rect, scale: 1 };
			params.captureBeyondViewport = true;
		}
		const { data } = await cdp.send('Page.captureScreenshot', params);
		writeFileSync(out, Buffer.from(data, 'base64'));
		console.log(out);
	} finally {
		cdp.close();
	}
}

async function main() {
	const [cmd, ...args] = process.argv.slice(2);
	if (cmd === 'launch') return launch();
	if (cmd === 'shot') return shot(args);
	if (cmd === 'eval' || cmd === 'command' || cmd === 'reload') {
		const cdp = await connect();
		try {
			if (cmd === 'reload') {
				// Do not rely on a file watcher having noticed the build yet.
				const id = JSON.stringify(args[0]);
				const ok = await evaluate(
					cdp,
					`(async () => { await app.plugins.disablePlugin(${id}); await app.plugins.enablePlugin(${id}); return !!app.plugins.plugins[${id}]; })()`,
				);
				if (!ok) throw new Error(`Could not reload plugin ${args[0]}`);
			} else if (cmd === 'eval') {
				console.log(JSON.stringify(await evaluate(cdp, args.join(' ')), null, 2));
			} else {
				const ok = await evaluate(cdp, `app.commands.executeCommandById(${JSON.stringify(args[0])})`);
				if (!ok) throw new Error(`Command not found or not available: ${args[0]}`);
			}
		} finally {
			cdp.close();
		}
		return;
	}
	console.error('Usage: obsidian-cdp.mjs launch | shot [out.png] [--selector css] [--viewport WxH] | eval <js> | command <id> | reload <plugin-id>');
	process.exitCode = 1;
}

main().catch((e) => {
	console.error(e.message);
	process.exitCode = 1;
});
