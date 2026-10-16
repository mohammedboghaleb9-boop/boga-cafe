// `npm run check:real-build [dir]`: the checks of scripts/real-build.mjs on a finished build (default
// dist), for CI and by hand. The "coming soon" build runs the same checks on its own folder (vite.config.ts).
import { existsSync } from 'node:fs';
import { realBuildProblems } from './real-build.mjs';

const dir = process.argv[2] ?? 'dist';
if (!existsSync(dir)) {
  console.error(`No build in ${dir}: run \`npm run build\` first.`);
  process.exit(1);
}
const { problems, summary } = realBuildProblems(dir);
if (problems.length) {
  console.error(`The real build (${dir}) ships what it must not:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`real build clean (${dir}): ${summary}`);
