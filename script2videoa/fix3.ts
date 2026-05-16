import fs from 'fs';
let code = fs.readFileSync('script2videoa/src/App.tsx', 'utf8');
code = code.replace(/<div className="space-y-3">\s*<label className="text-\[10px\] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">\s*<Key size=\{12\} \/> Pexels API Key \(Optional if set on server\)\s*<\/label>[\s\S]*?<\/div>/g, '');
code = code.replace(/<div className="space-y-3">\s*<label className="text-\[10px\] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">\s*<Key size=\{12\} \/> Pixabay API Key \(Optional if set on server\)\s*<\/label>[\s\S]*?<\/div>/g, '');
fs.writeFileSync('script2videoa/src/App.tsx', code);
console.log('done');
