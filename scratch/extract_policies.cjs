const fs = require('fs');
const path = require('path');

const migrationsDir = 'c:\\Users\\josep\\Documents\\The IoTank V2.0.0\\supabase\\migrations';
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

let policies = [];

for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const regex = /CREATE POLICY\s+"([^"]+)"\s+ON\s+([^\s]+)\s+.*?USING\s*\((.*?)\)/gis;
  
  let match;
  while ((match = regex.exec(content)) !== null) {
    policies.push({
      file,
      name: match[1],
      table: match[2],
      using: match[3]
    });
  }
}

fs.writeFileSync('c:\\Users\\josep\\Documents\\The IoTank V2.0.0\\scratch\\extracted_policies.json', JSON.stringify(policies, null, 2));
console.log('Extracted ' + policies.length + ' policies.');
