const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../supabase/migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

let tables = new Set();
let rlsEnabled = new Set();

for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    
    // Match CREATE TABLE
    const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/gi;
    let match;
    while ((match = createRegex.exec(content)) !== null) {
        let tableName = match[1].replace(/"/g, '').replace('public.', '');
        tables.add(tableName);
    }
    
    // Match ENABLE ROW LEVEL SECURITY
    const rlsRegex = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_."]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
    while ((match = rlsRegex.exec(content)) !== null) {
        let tableName = match[1].replace(/"/g, '').replace('public.', '');
        rlsEnabled.add(tableName);
    }
}

const noRls = [...tables].filter(t => !rlsEnabled.has(t));
console.log('Tables created:', tables.size);
console.log('Tables with RLS enabled:', rlsEnabled.size);
console.log('Tables without RLS explicitly enabled:');
console.log(noRls);
