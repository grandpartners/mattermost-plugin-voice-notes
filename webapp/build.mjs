import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/index.jsx')],
    outfile: path.join(root, 'dist/main.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    alias: {
        react: path.join(root, 'src/shims/react.js'),
        'react-intl': path.join(root, 'src/shims/react-intl.js'),
    },
    define: {'process.env.NODE_ENV': '"production"'},
    target: ['chrome100', 'safari15', 'firefox115'],
    metafile: true,
});

const out = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]];
process.stdout.write(`web bundle: ${(out.bytes / 1024).toFixed(1)} KB\n`);

const encoderSourcePath = path.join(root, 'node_modules/@breezystack/lamejs/dist/lamejs.iife.js');
const encoderBundlePath = path.join(root, '../server/mobile/lamejs.js');
await fs.copyFile(encoderSourcePath, encoderBundlePath);
const encoderStats = await fs.stat(encoderBundlePath);
process.stdout.write(`mobile MP3 encoder: ${(encoderStats.size / 1024).toFixed(1)} KB\n`);
