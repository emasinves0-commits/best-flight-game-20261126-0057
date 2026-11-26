// Merapi Airmail — entrypoint for the best-flight-game-20261126-0057 bounty.
// The game is a bush-plane mail run over a volcanic archipelago at golden hour:
// a hand-rolled mini-3D engine on a plain 2D canvas (no libraries, no network
// requests), keyboard + mouse, synthesized WebAudio. One core loop — fly, thread
// the rings, land to refuel — across three contracts: Ring Run (8 gold rings,
// then home), Airmail (deliver mail to the Palm and Green island strips, then
// home), and Storm Rescue (punch through the storm to the lighthouse strip in
// 180 seconds). This file is the handover: it copies game/ and screenshots/
// beside it into /output and writes /output/dossier.json, the summary the judge
// reads, using the vendored make.fun library.
//
// Local preview: `node serve.ts`, then open http://localhost:8080 in a desktop browser.
// Outside the grading container, set MAKEFUN_OUTPUT_DIR to stage the output elsewhere:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The caps below mirror the scorer's own gates (reference/gate.json). Only
// text_max_bytes changes the dossier's byte count; the rest exist to refuse an
// entry the scorer would refuse anyway — too many screenshots, or one too big;
// a game folder with too many files, too many bytes, or a path that runs too
// long. game/ is counted next to /output's own limits, together with its
// screenshots/ and dossier.json.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// Handover summary: count what was staged and print it, so anyone running this
// entrypoint can see at a glance that the game, its screenshots and the dossier
// all made it into /output.
function walkFiles(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = walkFiles(path);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += statSync(path).size;
    }
  }
  return { files, bytes };
}

const gameStats = walkFiles(join(out, 'game'));
const shotCount = existsSync(join(out, 'screenshots'))
  ? readdirSync(join(out, 'screenshots')).length
  : 0;
const dossierBytes = statSync(join(out, 'dossier.json')).size;
console.log(
  `Merapi Airmail staged in ${out}: ${gameStats.files} game files (${gameStats.bytes} bytes), ${shotCount} screenshots, dossier.json ${dossierBytes} bytes.`,
);
