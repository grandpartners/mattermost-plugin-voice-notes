import * as esbuild from 'esbuild';
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
process.stdout.write(`bundle: ${(out.bytes / 1024).toFixed(1)} KB\n`);
