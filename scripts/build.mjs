import { build } from 'esbuild';
await build({entryPoints:['web/app.jsx'],bundle:true,outfile:'build/app.js',format:'esm',target:'es2022',minify:true,
  legalComments:'linked',define:{'process.env.NODE_ENV':'"production"'}});
console.log('Built community workbench');
