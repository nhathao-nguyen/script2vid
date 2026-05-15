const fs = require('fs');
let code = fs.readFileSync('script2videoa/server.ts', 'utf8');

// Remove import
code = code.replace(/import \{ GoogleGenAI \} from '@google\/genai';\n/, '');

// Remove all gemini functions
code = code.replace(/const GEMINI_MODEL[\s\S]+?const DEFAULT_IMAGE_PROVIDERS/m, 'const DEFAULT_IMAGE_PROVIDERS');

// Remove express routes for gemini
code = code.replace(/app\.post\('\/api\/gemini\/context'[\s\S]+?app\.post\('\/api\/gemini\/split'[\s\S]+?app\.post\('\/api\/gemini\/analyze'[\s\S]+?app\.post\('\/api\/media\/search'/m, "app.post('/api/media/search'");

fs.writeFileSync('script2videoa/server.ts', code);
