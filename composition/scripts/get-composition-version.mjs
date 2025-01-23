import fs from 'fs';
import { fileURLToPath } from 'node:url';
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compositionVersion = '{{$COMPOSITION__VERSION}}';

// From pnpm v10+, hooks will not be supported.
if (process.argv[1] === __filename) {
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')).toString());
  const version = json.version;
  const varFilePath = path.join(__dirname, '../dist/utils/composition-version.js');
  let content = fs.readFileSync(varFilePath).toString();
  if (content.indexOf(compositionVersion) < 0) {
    throw new Error(`"${compositionVersion}" string not found in dist/utils/composition-version.js.`);
  }
  content = content.replace(compositionVersion, version);
  fs.writeFileSync(varFilePath, content);
}