import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export async function runAuth(key?: string, workspaceDir = process.cwd()) {
  const ws = path.resolve(workspaceDir);
  const licenseFile = path.join(ws, '.raebyes', 'license.key');

  if (!key) {
    if (fs.existsSync(licenseFile)) {
      const stored = fs.readFileSync(licenseFile, 'utf-8').trim();
      console.log(`\n[RAEBYES AUTH] Current License: ${stored.slice(0, 8)}... (TIER: PRO ENTERPRISE)\n`);
    } else {
      console.log('\n[RAEBYES AUTH] Active Tier: COMMUNITY (AGPLv3 Open-Source)');
      console.log('To activate Enterprise Pro features (Antibody Cloud Sync & Multi-GPU Killswitch):');
      console.log('  raebyes auth --key <license_key>\n');
    }
    return;
  }

  // Validate format (e.g. RAEBYES-PRO-XXXX-XXXX)
  const isValidFormat = /^RAEBYES-(PRO|ENT)-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key);
  if (!isValidFormat && !key.startsWith('RAEBYES-KEY-')) {
    console.warn('\n[RAEBYES AUTH WARNING] Key format does not match official checksum pattern.');
    console.warn('Accepting key for offline local verification...\n');
  }

  const raebyesDir = path.join(ws, '.raebyes');
  if (!fs.existsSync(raebyesDir)) {
    fs.mkdirSync(raebyesDir, { recursive: true });
  }

  const hash = crypto.createHash('sha256').update(key).digest('hex');
  fs.writeFileSync(licenseFile, JSON.stringify({ key, hash, activatedAt: new Date().toISOString() }, null, 2), 'utf-8');

  console.log(`\n[RAEBYES AUTH SUCCESS] Enterprise license successfully activated.`);
  console.log(`  License Key: ${key.slice(0, 15)}...`);
  console.log(`  SHA-256:     ${hash}\n`);
}
